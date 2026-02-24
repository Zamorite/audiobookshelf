/**
 * SRT Parser Utility (server-side)
 * Pure functions with no dependencies — safe to require in tests.
 */

/**
 * Parses a raw SRT string into an array of subtitle objects.
 * @param {string} srtText
 * @returns {Array<{id: number, start: number, end: number, text: string}>}
 */
function parseSrt(srtText) {
  if (!srtText) return []
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n{2,}/)
  const subtitles = []
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    const lines = trimmed.split('\n')
    if (lines.length < 3) continue
    const id = parseInt(lines[0].trim(), 10)
    const tsParts = lines[1].split(' --> ')
    if (tsParts.length !== 2) continue
    const start = srtTimeToSeconds(tsParts[0].trim())
    const end = srtTimeToSeconds(tsParts[1].trim())
    if (isNaN(start) || isNaN(end)) continue
    const text = lines.slice(2).join('\n').trim()
    subtitles.push({ id, start, end, text })
  }
  return subtitles
}

/**
 * Converts an SRT timestamp (HH:MM:SS,ms or HH:MM:SS.ms) to seconds.
 * Returns NaN for unparseable input.
 * @param {string} ts
 * @returns {number}
 */
function srtTimeToSeconds(ts) {
  const parts = ts.replace(',', '.').split(':')
  if (parts.length !== 3) return NaN
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
}

/**
 * Binary search to find the active subtitle based on the current playback time.
 * Works on any contiguous slice of the full subtitle array.
 *
 * @param {Array<{start: number, end: number}>} subtitles
 * @param {number} currentTime - Playback time in seconds
 * @returns {number} Index of the active subtitle, or -1 if none
 */
function findActiveSubtitleIndex(subtitles, currentTime) {
  if (!subtitles || !subtitles.length) return -1

  let left = 0
  let right = subtitles.length - 1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const sub = subtitles[mid]

    if (currentTime >= sub.start && currentTime <= sub.end) {
      return mid
    } else if (currentTime < sub.start) {
      right = mid - 1
    } else {
      left = mid + 1
    }
  }

  return -1
}

module.exports = { parseSrt, srtTimeToSeconds, findActiveSubtitleIndex }
