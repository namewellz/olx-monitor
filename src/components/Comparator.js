'use strict'

const HAMMING_THRESHOLD  = 5
const SIMILARITY_THRESHOLD = 0.70

function hammingDistance(a, b) {
  let dist = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++
  return dist
}

function findMatches(source, target) {
  const matches = []
  for (const s of source) {
    let bestDist = Infinity, bestT = null
    for (const t of target) {
      const dist = hammingDistance(s.hash, t.hash)
      if (dist < bestDist) { bestDist = dist; bestT = t }
    }
    if (bestDist <= HAMMING_THRESHOLD) {
      matches.push({ urlA: s.url, urlB: bestT.url, distance: bestDist })
    }
  }
  return matches
}

function compare(hashesA, hashesB) {
  const validA = hashesA.filter(h => h.hash !== null)
  const validB = hashesB.filter(h => h.hash !== null)

  if (validA.length === 0 || validB.length === 0) {
    return { coverageSmaller: 0, coverageGeneral: 0, matches: [], verdict: 'SEM IMAGENS' }
  }

  const matchesAtoB = findMatches(validA, validB)
  const matchesBtoA = findMatches(validB, validA)

  const coverageAinB = matchesAtoB.length / validA.length
  const coverageBinA = matchesBtoA.length / validB.length
  const coverageGeneral = (coverageAinB + coverageBinA) / 2

  const [smaller, , matchesForSmaller] =
    validA.length <= validB.length
      ? [validA, validB, matchesAtoB]
      : [validB, validA, matchesBtoA]

  const coverageSmaller = matchesForSmaller.length / smaller.length

  const verdict = coverageSmaller >= SIMILARITY_THRESHOLD
    ? (coverageSmaller >= 0.90 ? 'DUPLICATA' : 'POSSÍVEL DUPLICATA')
    : 'ANÚNCIOS DIFERENTES'

  return { coverageSmaller, coverageGeneral, coverageAinB, coverageBinA,
           countA: validA.length, countB: validB.length,
           matches: matchesForSmaller, verdict }
}

module.exports = { compare }
