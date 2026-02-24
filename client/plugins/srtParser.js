/**
 * SRT Client-Side Utilities
 *
 * Note: SRT parsing (parseSrt, srtTimeToSeconds) lives server-side in
 * server/utils/srtParser.js. This module only exports what the client
 * actually uses at runtime.
 */

/**
 * Binary search to find the active subtitle based on the current playback time.
 * Works on any contiguous slice of the full subtitle array.
 *
 * @param {Array<{start: number, end: number}>} subtitles - The current window of subtitles
 * @param {number} currentTime - Current playback time in seconds
 * @returns {number} Index of the active subtitle within the array, or -1 if none
 */
export function findActiveSubtitleIndex(subtitles, currentTime) {
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
