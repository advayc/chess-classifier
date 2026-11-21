const runtimes = {
  threaded: 'stockfish-19.js',
  single: 'stockfish-19-single.js',
}
const MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export function engineInfo(message) {
  if (!message.startsWith('info depth ')) return null
  const depth = Number(message.match(/\bdepth (\d+)/)?.[1])
  const score = message.match(/\bscore (cp|mate) (-?\d+)/)
  const wdl = message.match(/\bwdl (\d+) (\d+) (\d+)/)?.slice(1).map(Number)
  const pv = message.match(/\bpv (.+)$/)?.[1].trim().split(/\s+/)
  if (!depth || !score || !pv?.length || !pv.every(move => MOVE.test(move))) return null
  return {
    depth, type: score[1], score: Number(score[2]), pv,
    wdl: wdl?.reduce((sum, number) => sum + number, 0) === 1000 ? wdl : null,
    rank: Number(message.match(/\bmultipv (\d+)/)?.[1] || 1),
    bound: /\b(?:lowerbound|upperbound)\b/.test(message),
  }
}

export class Engine {
  #worker
  #job
  #ready = false
  #startup
  #threaded = globalThis.crossOriginIsolated && navigator.hardwareConcurrency >= 4

  constructor(runtime) {
    this.runtime = runtime
  }

  start({ fen, history, legalMoves, deep = false, update, complete, fail }) {
    this.cancel()
    const position = history?.moves.length ?
      `position fen ${history.startFen} moves ${history.moves.join(' ')}` : `position fen ${fen}`
    this.#job = { position, legalMoves, deep, update, complete, fail, stage: 'loading', best: null, top: null, alternatives: new Map() }
    if (this.#ready) this.#search()
    else this.#boot()
  }

  stop() {
    const job = this.#job
    if (!job) return
    job.stopped = true
    if (job.stage === 'loading') {
      this.cancel()
      job.complete({ best: null, alternatives: [], stopped: true })
    } else {
      this.#send('stop')
    }
  }

  cancel() {
    if (this.#job) this.#dispose()
    this.#job = null
  }

  #dispose() {
    clearTimeout(this.#startup)
    this.#worker?.terminate()
    this.#worker = null
    this.#ready = false
  }

  #send(command) {
    this.#worker.postMessage(command)
  }

  #boot() {
    const threaded = this.#threaded
    let worker
    try {
      worker = new Worker(new URL(threaded ? runtimes.threaded : runtimes.single, this.runtime))
    } catch {
      const job = this.#job
      this.#job = null
      job.fail('This browser couldn’t start the Stockfish worker.')
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

  #search() {
    const job = this.#job
    job.stage = 'primary'
    job.update({ stage: job.stage })
    this.#send('setoption name MultiPV value 1')
    this.#send(job.position)
    this.#send(job.deep ? 'go infinite' : 'go depth 24 movetime 20000')
  }

  #finish() {
    const job = this.#job
    this.#job = null
    job.complete({
      best: job.best,
      alternatives: [...job.alternatives.values()].sort((a, b) => a.rank - b.rank),
      stopped: job.stopped,
    })
  }

  #receive(line) {
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
      if (this.#job) this.#search()
      return
    }

    const job = this.#job
    if (!job || job.stage === 'loading') return
    const info = engineInfo(line)
    if (info) {
      if (!job.legalMoves.includes(info.pv[0])) return
      if (job.stage === 'primary' && (!info.bound || !job.top)) {
        job.top = info
        job.update({ stage: 'primary', best: info })
      }
      if (job.stage === 'alternatives' && info.pv[0] !== job.best.pv[0] && !info.bound) {
        const lines = job.pendingAlternatives.get(info.depth) || new Map()
        lines.set(info.rank, info)
        job.pendingAlternatives.set(info.depth, lines)
        const unique = new Set([...lines.values()].map(candidate => candidate.pv[0]))
        if (unique.size === job.alternativeCount && info.depth >= job.alternativeDepth) {
          job.alternatives = lines
          job.alternativeDepth = info.depth
          job.update({ stage: 'alternatives', best: job.best, alternatives: [...lines.values()].sort((a, b) => a.rank - b.rank) })
        }
      }
      return
    }

    const bestMove = line.match(/^bestmove (\S+)/)?.[1]
    if (!bestMove) return
    if (job.stage === 'alternatives') {
      this.#finish()
      return
    }
    if (job.legalMoves.includes(bestMove)) {
      job.best = job.top?.pv[0] === bestMove ? job.top : { pv: [bestMove] }
    }
    if (!job.best || job.stopped || job.deep || job.legalMoves.length < 2) {
      this.#finish()
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
