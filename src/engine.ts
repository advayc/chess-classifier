import type { EngineInfo } from './types'

const MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export function engineInfo(message: string): EngineInfo | null {
  if (!message.startsWith('info depth ')) return null
  const depth = Number(message.match(/\bdepth (\d+)/)?.[1])
  const score = message.match(/\bscore (cp|mate) (-?\d+)/)
  const wdl = message.match(/\bwdl (\d+) (\d+) (\d+)/)?.slice(1).map(Number)
  const pv = message.match(/\bpv (.+)$/)?.[1].trim().split(/\s+/)
  if (!depth || !score || !pv?.length || !pv.every(move => MOVE.test(move))) return null
  return {
    depth,
    type: score[1] as 'cp' | 'mate',
    score: Number(score[2]),
    pv,
    wdl: wdl?.reduce((sum, number) => sum + number, 0) === 1000 ? wdl : null,
    rank: Number(message.match(/\bmultipv (\d+)/)?.[1] || 1),
    bound: /\b(?:lowerbound|upperbound)\b/.test(message),
  }
}

type History = { startFen: string; moves: string[] }
type EngineResult = { best: EngineInfo | null; alternatives: EngineInfo[]; stopped?: boolean }
type EngineUpdate = Omit<EngineResult, 'stopped'>
type Search = {
  position: string
  moves: Set<string>
  multipv: number
  command: string
  update?: (result: EngineUpdate) => void
  complete: (lines: EngineInfo[], stopped?: boolean) => void
  fail: (message: string) => void
  byMove: Map<string, EngineInfo>
  batches: Map<number, Map<number, EngineInfo>>
  stopped?: boolean
  discard?: boolean
}

const START_TIMEOUT = 30_000
const STOP_TIMEOUT = 1_500
const ANALYSIS_CACHE_SIZE = 24

function positionCommand(fen: string, history?: History): string {
  return history?.moves.length ? `position fen ${history.startFen} moves ${history.moves.join(' ')}` : `position fen ${fen}`
}

function analysisResult([best, ...alternatives]: EngineInfo[], stopped?: boolean): EngineResult {
  return { best: best ?? null, alternatives, stopped }
}

export class Engine {
  #worker: Worker | null = null
  #active: Search | null = null
  #queued: Search | null = null
  #ready = false
  #startup: ReturnType<typeof setTimeout> | undefined
  #stopping: ReturnType<typeof setTimeout> | undefined
  #threaded = globalThis.crossOriginIsolated && typeof navigator !== 'undefined' &&
    navigator.hardwareConcurrency >= 4
  #recentAnalyses = new Map<string, EngineInfo[]>()

  constructor(private readonly runtime: string) {}

  prepare() {
    if (!this.#worker) this.#boot()
  }

  start({ fen, history, legalMoves, deep = false, update, complete, fail }: {
    fen: string
    history?: History
    legalMoves: string[]
    deep?: boolean
    update: (result: EngineUpdate) => void
    complete: (result: EngineResult) => void
    fail: Search['fail']
  }) {
    const position = positionCommand(fen, history)
    const cached = deep ? undefined : this.#recentAnalyses.get(position)
    if (cached) {
      this.cancel()
      complete(analysisResult(cached))
      return
    }
    this.#schedule({
      position,
      moves: new Set(legalMoves),
      multipv: deep ? 1 : Math.max(1, Math.min(3, legalMoves.length)),
      command: deep ? 'go infinite' : 'go depth 18 movetime 850',
      update,
      complete: (lines, stopped) => {
        if (!deep && !stopped && lines.length) {
          this.#recentAnalyses.set(position, lines)
          if (this.#recentAnalyses.size > ANALYSIS_CACHE_SIZE) {
            const oldest = this.#recentAnalyses.keys().next()
            if (!oldest.done) this.#recentAnalyses.delete(oldest.value)
          }
        }
        complete(analysisResult(lines, stopped))
      },
      fail,
    })
  }

  /** Shallow MultiPV search used by full-game review. */
  evaluate({ fen, history, legalMoves, multipv = 2, depth = 14, movetime = 350, searchMoves, complete, fail }: {
    fen: string
    history?: History
    legalMoves: string[]
    multipv?: number
    depth?: number
    movetime?: number
    searchMoves?: string[]
    complete: (result: { lines: EngineInfo[]; stopped?: boolean }) => void
    fail: Search['fail']
  }) {
    const restricted = searchMoves?.length ? ` searchmoves ${searchMoves.join(' ')}` : ''
    this.#schedule({
      position: positionCommand(fen, history),
      moves: new Set(searchMoves?.length ? searchMoves : legalMoves),
      multipv: Math.max(1, Math.min(multipv, searchMoves?.length || legalMoves.length)),
      command: `go depth ${depth} movetime ${movetime}${restricted}`,
      complete: (lines, stopped) => complete({ lines, stopped }),
      fail,
    })
  }

  stop() {
    if (this.#queued) {
      const job = this.#queued
      this.#queued = null
      job.complete([], true)
    } else if (this.#active && !this.#active.discard) {
      this.#active.stopped = true
      this.#interrupt()
    }
  }

  cancel() {
    this.#queued = null
    if (this.#active && !this.#active.discard) {
      this.#active.discard = true
      this.#interrupt()
    }
  }

  dispose() {
    this.#resetWorker()
    this.#active = null
    this.#queued = null
    this.#recentAnalyses.clear()
  }

  #schedule(job: Omit<Search, 'byMove' | 'batches'>) {
    this.cancel()
    this.#queued = { ...job, byMove: new Map(), batches: new Map() }
    this.prepare()
    this.#run()
  }

  #resetWorker() {
    clearTimeout(this.#startup)
    clearTimeout(this.#stopping)
    this.#stopping = undefined
    this.#worker?.terminate()
    this.#worker = null
    this.#ready = false
  }

  #send(command: string) {
    this.#worker?.postMessage(command)
  }

  #interrupt() {
    if (this.#stopping !== undefined) return
    this.#send('stop')
    this.#stopping = setTimeout(() => {
      const job = this.#active
      this.#active = null
      this.#resetWorker()
      if (job && !job.discard) job.complete([], true)
      if (this.#queued) this.prepare()
    }, STOP_TIMEOUT)
  }

  #boot() {
    const threaded = this.#threaded
    const failed = () => {
      const starting = !this.#ready
      this.#resetWorker()
      if (threaded && starting) {
        this.#threaded = false
        if (this.#queued) this.prepare()
        return
      }
      const active = this.#active
      const queued = this.#queued
      this.#active = null
      this.#queued = null
      const message = 'Stockfish couldn’t finish this search. Try again.'
      if (active && !active.discard) active.fail(message)
      queued?.fail(message)
    }

    let worker: Worker
    try {
      const build = threaded ? 'stockfish-19-lite.js' : 'stockfish-19-lite-single.js'
      worker = new Worker(new URL(build, this.runtime))
    } catch {
      failed()
      return
    }
    this.#worker = worker
    worker.onmessage = ({ data }) => {
      for (const line of String(data).split('\n')) {
        if (worker !== this.#worker) return
        this.#receive(line.trim())
      }
    }
    const onError = () => { if (worker === this.#worker) failed() }
    worker.onerror = onError
    worker.onmessageerror = onError
    this.#startup = setTimeout(onError, START_TIMEOUT)
    this.#send('uci')
  }

  #run() {
    const job = this.#queued
    if (!this.#ready || this.#active || !job) return
    this.#queued = null
    this.#active = job
    this.#send(`setoption name MultiPV value ${job.multipv}`)
    this.#send(job.position)
    this.#send(job.command)
    job.update?.({ best: null, alternatives: [] })
  }

  #receive(line: string) {
    if (line === 'uciok') {
      if (this.#threaded) this.#send(`setoption name Threads value ${Math.min(4, navigator.hardwareConcurrency - 1)}`)
      this.#send('setoption name Hash value 32')
      this.#send('setoption name UCI_ShowWDL value true')
      this.#send('isready')
      return
    }
    if (line === 'readyok' && !this.#ready) {
      clearTimeout(this.#startup)
      this.#ready = true
      this.#run()
      return
    }

    const job = this.#active
    if (!job) return
    const move = line.match(/^bestmove (\S+)/)?.[1]
    if (move) {
      this.#active = null
      clearTimeout(this.#stopping)
      this.#stopping = undefined
      // Stockfish emits bestmove after stop. A replacement may start once that search is drained.
      if (!job.discard) this.#finish(job, move)
      this.#run()
      return
    }
    if (job.discard) return

    const info = engineInfo(line)
    if (!info || !job.moves.has(info.pv[0])) return
    const previous = job.byMove.get(info.pv[0])
    if (!previous || !info.bound) job.byMove.set(info.pv[0], info)
    if (info.bound) return

    const batch = job.batches.get(info.depth) ?? new Map<number, EngineInfo>()
    batch.set(info.rank, info)
    job.batches.set(info.depth, batch)
    if (batch.size === job.multipv && job.update) {
      const lines = [...batch.values()].sort((a, b) => a.rank - b.rank)
      job.update(analysisResult(lines))
    }
  }

  #finish(job: Search, move: string) {
    const best = job.byMove.get(move)
    const ranked = [...job.batches].reverse().find(([, batch]) =>
      batch.size === job.multipv && batch.get(1)?.pv[0] === move,
    )?.[1]
    const lines = ranked ? [...ranked.values()].sort((a, b) => a.rank - b.rank) : best ? [best] : []
    job.complete(lines, job.stopped)
  }
}
