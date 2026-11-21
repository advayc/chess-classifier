import type { EngineInfo } from './types'

const runtimes = {
  threaded: 'stockfish-19.js',
  single: 'stockfish-19-single.js',
}
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

type Stage = 'loading' | 'primary' | 'alternatives'
type EngineUpdate = { stage: Stage; best?: EngineInfo | null; alternatives?: EngineInfo[] }
type EngineResult = { best: EngineInfo | null; alternatives: EngineInfo[]; stopped?: boolean }
type EvalResult = { lines: EngineInfo[]; stopped?: boolean }

type AnalyzeJob = {
  kind: 'analysis'
  update: (payload: EngineUpdate) => void
  complete: (payload: EngineResult) => void
  fail: (message: string) => void
  position: string
  legalMoves: string[]
  deep: boolean
  stage: Stage
  best: EngineInfo | null
  top: EngineInfo | null
  primaryLines: Map<string, EngineInfo>
  alternatives: Map<number, EngineInfo>
  stopped?: boolean
  alternativeCount?: number
  alternativeDepth?: number
  pendingAlternatives?: Map<number, Map<number, EngineInfo>>
}

type EvalJob = {
  complete: (payload: EvalResult) => void
  fail: (message: string) => void
  searchMoves?: string[]
  kind: 'eval'
  position: string
  legalMoves: string[]
  multipv: number
  depth: number
  movetime: number
  stage: string
  byMove: Map<string, EngineInfo>
  batches: Map<number, Map<number, EngineInfo>>
  stopped?: boolean
}

export class Engine {
  #worker: Worker | null = null
  #job: AnalyzeJob | EvalJob | null = null
  #ready = false
  #startup: ReturnType<typeof setTimeout> | undefined
  #threaded = globalThis.crossOriginIsolated && typeof navigator !== 'undefined' &&
    navigator.hardwareConcurrency >= 4
  runtime: string

  constructor(runtime: string) {
    this.runtime = runtime
  }

  start({
    fen, history, legalMoves, deep = false, update, complete, fail,
  }: {
    fen: string
    history?: { startFen: string; moves: string[] }
    legalMoves: string[]
    deep?: boolean
    update: AnalyzeJob['update']
    complete: AnalyzeJob['complete']
    fail: AnalyzeJob['fail']
  }) {
    this.cancel()
    const position = history?.moves.length ?
      `position fen ${history.startFen} moves ${history.moves.join(' ')}` : `position fen ${fen}`
    this.#job = {
      kind: 'analysis', position, legalMoves, deep, update, complete, fail,
      stage: 'loading', best: null, top: null, primaryLines: new Map(), alternatives: new Map(),
    }
    if (this.#ready) this.#searchAnalyze()
    else this.#boot()
  }

  /** Shallow MultiPV search used by full-game review. */
  evaluate({
    fen, history, legalMoves, multipv = 2, depth = 14, movetime = 350, searchMoves, complete, fail,
  }: {
    fen: string
    history?: { startFen: string; moves: string[] }
    legalMoves: string[]
    multipv?: number
    depth?: number
    movetime?: number
    searchMoves?: string[]
    complete: EvalJob['complete']
    fail: EvalJob['fail']
  }) {
    this.cancel()
    const position = history?.moves.length ?
      `position fen ${history.startFen} moves ${history.moves.join(' ')}` : `position fen ${fen}`
    this.#job = {
      kind: 'eval',
      position,
      legalMoves,
      multipv: Math.min(multipv, Math.max(1, legalMoves.length)),
      depth,
      movetime,
      searchMoves,
      complete,
      fail,
      stage: 'loading',
      byMove: new Map(),
      batches: new Map(),
    }
    if (this.#ready) this.#searchEval()
    else this.#boot()
  }

  stop() {
    const job = this.#job
    if (!job) return
    job.stopped = true
    if (job.stage === 'loading') {
      this.cancel()
      if ('kind' in job && job.kind === 'eval') {
        job.complete({ lines: [], stopped: true })
      } else {
        job.complete({ best: null, alternatives: [], stopped: true })
      }
    } else {
      this.#send('stop')
    }
  }

  cancel() {
    if (this.#job) this.#dispose()
    this.#job = null
  }

  dispose() {
    this.#dispose()
    this.#job = null
  }

  #dispose() {
    clearTimeout(this.#startup)
    this.#worker?.terminate()
    this.#worker = null
    this.#ready = false
  }

  #send(command: string) {
    this.#worker?.postMessage(command)
  }

  #boot() {
    const threaded = this.#threaded
    let worker: Worker
    try {
      worker = new Worker(new URL(threaded ? runtimes.threaded : runtimes.single, this.runtime))
    } catch {
      const job = this.#job
      this.#job = null
      job?.fail('This browser couldn’t start the Stockfish worker.')
      return
    }
    this.#worker = worker
    worker.onmessage = ({ data }) => {
      if (worker !== this.#worker) return
      for (const line of String(data).split('\n')) this.#receive(line.trim())
    }
    const onError = () => {
      if (worker !== this.#worker) return
      this.#dispose()
      if (threaded && this.#job?.stage === 'loading') {
        this.#threaded = false
        this.#boot()
        return
      }
      const job = this.#job
      this.#job = null
      job?.fail('Stockfish couldn’t start or finish the search. Try analyzing again.')
    }
    worker.onerror = onError
    worker.onmessageerror = onError
    this.#startup = setTimeout(onError, 5 * 60_000)
    this.#send('uci')
  }

  #searchAnalyze() {
    const job = this.#job as AnalyzeJob
    job.stage = 'primary'
    job.update({ stage: job.stage })
    this.#send('setoption name MultiPV value 1')
    this.#send(job.position)
    this.#send(job.deep ? 'go infinite' : 'go depth 24 movetime 20000')
  }

  #searchEval() {
    const job = this.#job as EvalJob
    job.stage = 'eval'
    this.#send(`setoption name MultiPV value ${job.multipv}`)
    this.#send(job.position)
    const restricted = job.searchMoves?.length ? ` searchmoves ${job.searchMoves.join(' ')}` : ''
    this.#send(`go depth ${job.depth} movetime ${job.movetime}${restricted}`)
  }

  #finishAnalyze() {
    const job = this.#job as AnalyzeJob
    this.#job = null
    job.complete({
      best: job.best,
      alternatives: [...job.alternatives.values()].sort((a, b) => a.rank - b.rank),
      stopped: job.stopped,
    })
  }

  #receive(line: string) {
    if (line === 'uciok') {
      if (this.#threaded) {
        this.#send(`setoption name Threads value ${Math.min(8, navigator.hardwareConcurrency - 1)}`)
      }
      this.#send(`setoption name Hash value ${this.#threaded ? 96 : 40}`)
      this.#send('setoption name UCI_ShowWDL value true')
      this.#send('isready')
      return
    }
    if (line === 'readyok' && !this.#ready) {
      clearTimeout(this.#startup)
      this.#ready = true
      if (!this.#job) return
      if ('kind' in this.#job && this.#job.kind === 'eval') this.#searchEval()
      else this.#searchAnalyze()
      return
    }

    const job = this.#job
    if (!job || job.stage === 'loading') return

    if ('kind' in job && job.kind === 'eval') {
      this.#receiveEval(line, job)
      return
    }
    this.#receiveAnalyze(line, job as AnalyzeJob)
  }

  #receiveEval(line: string, job: EvalJob) {
    const info = engineInfo(line)
    if (info && job.legalMoves.includes(info.pv[0])) {
      const previous = job.byMove.get(info.pv[0])
      if (!previous || !info.bound) job.byMove.set(info.pv[0], info)
      if (!info.bound) {
        const batch = job.batches.get(info.depth) ?? new Map<number, EngineInfo>()
        batch.set(info.rank, info)
        job.batches.set(info.depth, batch)
      }
      return
    }
    const move = line.match(/^bestmove (\S+)/)?.[1]
    if (!move) return
    const best = job.byMove.get(move)
    const batches = [...job.batches].sort(([a], [b]) => b - a)
    const ranked = batches.find(([, batch]) =>
      batch.size === job.multipv && batch.get(1)?.pv[0] === move,
    )?.[1]
    const candidates = ranked ? [...ranked.values()].sort((a, b) => a.rank - b.rank) : []
    const lines = best ? [best, ...candidates.filter(candidate => candidate.pv[0] !== move)] : []
    this.#job = null
    job.complete({ lines, stopped: job.stopped })
  }

  #receiveAnalyze(line: string, job: AnalyzeJob) {
    const info = engineInfo(line)
    if (info) {
      if (!job.legalMoves.includes(info.pv[0])) return
      if (job.stage === 'primary' && (!info.bound || !job.primaryLines.has(info.pv[0]))) {
        job.primaryLines.set(info.pv[0], info)
      }
      if (job.stage === 'primary' && (!info.bound || !job.top)) {
        job.top = info
        job.update({ stage: 'primary', best: info })
      }
      if (job.stage === 'alternatives' && info.pv[0] !== job.best?.pv[0] && !info.bound) {
        const lines = job.pendingAlternatives!.get(info.depth) || new Map()
        lines.set(info.rank, info)
        job.pendingAlternatives!.set(info.depth, lines)
        const unique = new Set([...lines.values()].map(candidate => candidate.pv[0]))
        if (unique.size === job.alternativeCount && info.depth >= (job.alternativeDepth || 0)) {
          job.alternatives = lines
          job.alternativeDepth = info.depth
          job.update({
            stage: 'alternatives',
            best: job.best,
            alternatives: [...lines.values()].sort((a, b) => a.rank - b.rank),
          })
        }
      }
      return
    }

    const bestMove = line.match(/^bestmove (\S+)/)?.[1]
    if (!bestMove) return
    if (job.stage === 'alternatives') {
      this.#finishAnalyze()
      return
    }
    job.best = job.primaryLines.get(bestMove) ?? null
    if (!job.best || job.stopped || job.deep || job.legalMoves.length < 2) {
      this.#finishAnalyze()
      return
    }

    const otherMoves = job.legalMoves.filter(move => move !== bestMove)
    job.stage = 'alternatives'
    job.alternativeCount = Math.min(2, otherMoves.length)
    job.alternativeDepth = 0
    job.pendingAlternatives = new Map()
    job.update({ stage: job.stage, best: job.best })
    this.#send(`setoption name MultiPV value ${job.alternativeCount}`)
    this.#send(job.position)
    this.#send(`go depth 18 movetime 3500 searchmoves ${otherMoves.join(' ')}`)
  }
}
