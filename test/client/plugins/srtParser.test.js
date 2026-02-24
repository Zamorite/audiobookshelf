const assert = require('assert')
const { parseSrt, srtTimeToSeconds, findActiveSubtitleIndex } = require('../../../server/utils/srtParser')

describe('SRT Parser Utility', () => {
  describe('srtTimeToSeconds', () => {
    it('should correctly convert HH:MM:SS,ms to seconds', () => {
      assert.strictEqual(srtTimeToSeconds('00:00:01,000'), 1)
      assert.strictEqual(srtTimeToSeconds('00:01:05,500'), 65.5)
      assert.strictEqual(srtTimeToSeconds('01:00:00,000'), 3600)
      assert.strictEqual(srtTimeToSeconds('01:15:30,250'), 3600 + 15 * 60 + 30.25)
    })

    it('should handle decimal points as well as commas', () => {
      assert.strictEqual(srtTimeToSeconds('00:00:01.500'), 1.5)
    })

    it('should return NaN for invalid formats', () => {
      assert.ok(isNaN(srtTimeToSeconds('invalid format')))
    })
  })

  describe('parseSrt', () => {
    it('should correctly parse a valid SRT string into structured objects', () => {
      const validSrt = '1\n00:00:01,000 --> 00:00:05,000\nThis is the first line.\nWith a second line.\n\n2\n00:00:06,000 --> 00:00:10,000\nThis is the second subtitle.'

      const result = parseSrt(validSrt)

      assert.strictEqual(result.length, 2)

      assert.deepStrictEqual(result[0], {
        id: 1,
        start: 1,
        end: 5,
        text: 'This is the first line.\nWith a second line.'
      })

      assert.deepStrictEqual(result[1], {
        id: 2,
        start: 6,
        end: 10,
        text: 'This is the second subtitle.'
      })
    })

    it('should handle empty or malformed strings gracefully', () => {
      assert.deepStrictEqual(parseSrt(''), [])
      assert.deepStrictEqual(parseSrt(null), [])
      assert.deepStrictEqual(parseSrt(undefined), [])
      assert.deepStrictEqual(parseSrt('Just some random text without formatting'), [])
    })

    it('should ignore blocks that are missing timestamps', () => {
      const malformedSrt = '1\nThis block has no timestamp.\n\n2\n00:00:01,000 --> 00:00:05,000\nThis block is valid.'

      const result = parseSrt(malformedSrt)
      assert.strictEqual(result.length, 1)
      assert.strictEqual(result[0].id, 2)
    })
  })

  describe('findActiveSubtitleIndex (Binary Search)', () => {
    const mockSubtitles = [
      { id: 1, start: 5, end: 10, text: 'First' },
      { id: 2, start: 12, end: 15, text: 'Second' },
      { id: 3, start: 20, end: 25, text: 'Third' },
      { id: 4, start: 30, end: 35, text: 'Fourth' }
    ]

    it('should find the exact active subtitle', () => {
      assert.strictEqual(findActiveSubtitleIndex(mockSubtitles, 7), 0) // Inside First
      assert.strictEqual(findActiveSubtitleIndex(mockSubtitles, 13), 1) // Inside Second
      assert.strictEqual(findActiveSubtitleIndex(mockSubtitles, 20), 2) // Exactly at start of Third
      assert.strictEqual(findActiveSubtitleIndex(mockSubtitles, 35), 3) // Exactly at end of Fourth
    })

    it('should return -1 when time falls in gaps between subtitles', () => {
      assert.strictEqual(findActiveSubtitleIndex(mockSubtitles, 0), -1) // Before first
      assert.strictEqual(findActiveSubtitleIndex(mockSubtitles, 11), -1) // Gap between First and Second
      assert.strictEqual(findActiveSubtitleIndex(mockSubtitles, 18), -1) // Gap between Second and Third
      assert.strictEqual(findActiveSubtitleIndex(mockSubtitles, 40), -1) // After last
    })

    it('should return -1 for empty data', () => {
      assert.strictEqual(findActiveSubtitleIndex([], 5), -1)
      assert.strictEqual(findActiveSubtitleIndex(null, 5), -1)
    })
  })
})
