/**
 * ASS Parser Utility (server-side)
 * Parses ASS subtitle formats with karaoke word-level timing.
 */

const { srtTimeToSeconds } = require('./srtParser')

/**
 * Converts an ASS timestamp (H:MM:SS.cs) to seconds.
 * Returns NaN for unparseable input.
 * @param {string} ts
 * @returns {number}
 */
function assTimeToSeconds(ts) {
  const parts = ts.replace(',', '.').split(':')
  if (parts.length !== 3) return NaN
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
}

/**
 * Parses a raw ASS string into an array of subtitle objects.
 * Supports word-level highlighting through Karaoke tags (\k, \kf, \ko, \K).
 * @param {string} assText
 * @returns {Array<{id: number, start: number, end: number, text: string, words: Array<{start: number, end: number, text: string}>}>}
 */
function parseAss(assText) {
  if (!assText) return []
  const normalized = assText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  const subtitles = []
  let idCounter = 1

  for (const line of lines) {
    if (!line.startsWith('Dialogue: ')) continue

    // Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    const content = line.substring(10) // remove "Dialogue: "
    const fields = content.split(',')

    // In actual ASS, the Text field might contain commas, so we join the rest of the array.
    if (fields.length < 10) continue

    const startObj = fields[1].trim()
    const endObj = fields[2].trim()

    const start = assTimeToSeconds(startObj)
    const end = assTimeToSeconds(endObj)

    if (isNaN(start) || isNaN(end)) continue

    const rawText = fields.slice(9).join(',').trim()

    // Now extract karaoke tags and words
    // Karaoke tag format: {\k10}Word {\kf20}Other word
    // The number is in centiseconds (1cs = 10ms = 0.01s)
    let text = ''
    const words = []
    let currentStart = start

    // Use regex to find tags and the text that follows them
    // Match `{\tag...}` optionally, then the text until the next tag or end.
    // Note: tags like \k, \kf, \ko, \K
    const tagRegex = /\{[^}]*\\[kK][fo]?[^}]*\}/g

    // Split the text by tags but keep the tags so we can see their values.
    // Or iterate over match indices.

    let lastIndex = 0
    let match

    // Some ASS lines might have text before the first karaoke tag.
    // We will parse properly:
    // Every block of text is optionally preceded by tags. We accumulated duration from tags.
    // However, the standard structure is: {\kfXXX}Text... {\kfYYY}Text...

    const tokenRegex = /(\{[^}]*\\[kK][fo]?\d+[^}]*\})([^{]*)/g
    let hasVoiceTags = false

    let matchCount = 0
    while ((match = tokenRegex.exec(rawText)) !== null) {
      matchCount++
      const tagBlock = match[1]
      let wordText = match[2]

      // extract duration from tag
      const durMatch = /\\[kK][fo]?(\d+)/.exec(tagBlock)
      let durationCs = 0
      if (durMatch) {
        durationCs = parseInt(durMatch[1], 10)
      }

      const durationSec = durationCs / 100

      // Clean up any other non-karaoke ASS tags in wordText (e.g. \N, \an, etc)
      let cleanWordText = wordText.replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n')

      const wordEnd = currentStart + durationSec

      if (cleanWordText) {
        text += cleanWordText
        words.push({
          start: currentStart,
          end: wordEnd,
          text: cleanWordText
        })
      }

      currentStart = wordEnd
      lastIndex = tokenRegex.lastIndex
    }

    // Fallback: if there were no karaoke tokens, just clean tags and add as one block.
    if (matchCount === 0) {
      let cleanText = rawText.replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n')
      text = cleanText
      if (cleanText) {
        words.push({
          start,
          end,
          text: cleanText
        })
      }
    }

    subtitles.push({
      id: idCounter++,
      start,
      end,
      text: text.trim(), // Might need to just use the joined words text, or trim it
      words
    })
  }

  return subtitles
}

module.exports = { parseAss, assTimeToSeconds }
