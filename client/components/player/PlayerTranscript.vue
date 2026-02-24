<template>
  <div v-if="show" class="transcript-container absolute inset-0 z-40 bg-primary/95 overflow-hidden w-full h-full flex flex-col p-4 shadow-inner">
    <!-- Header -->
    <div class="flex justify-between items-center mb-4 sticky top-0 bg-primary z-10 pb-2 border-b border-gray-700">
      <h3 class="text-lg font-semibold text-gray-200">{{ $strings.LabelTranscript || 'Transcript' }}</h3>
      <button @click="$emit('close')" class="text-gray-400 hover:text-white transition-colors" aria-label="Close Transcript">
        <span class="material-symbols text-2xl">close</span>
      </button>
    </div>

    <!-- Loading (initial fetch) -->
    <div v-if="loading" class="flex-grow flex items-center justify-center">
      <span class="material-symbols text-4xl animate-spin text-gray-500">sync</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-grow flex flex-col items-center justify-center text-error">
      <span class="material-symbols text-4xl mb-2">error_outline</span>
      <p>{{ error }}</p>
    </div>

    <!-- No transcript -->
    <div v-else-if="!window.length && !isFetchingWindow" class="flex-grow flex items-center justify-center text-gray-400">
      <p>No transcript data found.</p>
    </div>

    <!-- Virtual scroller -->
    <recycle-scroller v-else ref="scroller" class="flex-grow" :items="window" :item-size="ITEM_HEIGHT" key-field="id">
      <template #default="{ item, index }">
        <div class="transcript-item flex items-start gap-2 cursor-pointer px-1 py-2 rounded transition-colors duration-200" :class="activeIndex === index ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-300'" @click="seekToSubtitle(item.start)">
          <span class="text-xs text-gray-600 pt-1 shrink-0 w-14 text-right select-none">{{ formatTime(item.start) }}</span>
          <p class="text-base sm:text-lg leading-snug">{{ item.text }}</p>
        </div>
      </template>
    </recycle-scroller>

    <!-- Subtle prefetch indicator -->
    <div v-if="isFetchingWindow && window.length" class="text-center pb-1">
      <span class="text-xs text-gray-600 animate-pulse">Loading…</span>
    </div>
  </div>
</template>

<script>
import { findActiveSubtitleIndex } from '@/plugins/srtParser'

/** Width of the time window fetched per request, in seconds. */
const WINDOW_DURATION = 600 // 10 minutes

/** How many seconds before the window edge to trigger a prefetch. */
const PREFETCH_THRESHOLD = 60

/** Fixed height of each subtitle row in px — must match CSS. */
const ITEM_HEIGHT = 56

export default {
  props: {
    show: {
      type: Boolean,
      default: false
    },
    libraryItemId: {
      type: String,
      required: true
    },
    libraryFiles: {
      type: Array,
      default: () => []
    },
    currentTime: {
      type: Number,
      default: 0
    }
  },
  data() {
    return {
      /** Subtitle objects currently loaded in the sliding window. */
      window: [],
      /** Start time (seconds) of the currently loaded window. */
      windowFrom: 0,
      /** End time (seconds) of the currently loaded window. */
      windowTo: 0,
      /** Total subtitle count in the file (returned by server). */
      total: 0,
      /** Index of the active subtitle within `window`. */
      activeIndex: -1,
      loading: false,
      error: null,
      autoScroll: true,
      isFetchingWindow: false,
      ITEM_HEIGHT
    }
  },
  computed: {
    transcriptFile() {
      return this.libraryFiles.find((f) => f.metadata?.ext === '.srt')
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.autoScroll = true
        this.openTranscript()
      } else {
        this.cleanup()
      }
    },
    currentTime(newTime) {
      if (!this.show || !this.window.length) return

      const newIndex = findActiveSubtitleIndex(this.window, newTime)
      if (newIndex !== -1 && newIndex !== this.activeIndex) {
        this.activeIndex = newIndex
        if (this.autoScroll) {
          this.$nextTick(() => this.$refs.scroller?.scrollToItem(this.activeIndex))
        }
      }

      // Prefetch next window when approaching the edge
      if (newTime >= this.windowTo - PREFETCH_THRESHOLD && !this.isFetchingWindow) {
        this.fetchWindow(this.windowTo - 30) // 30s overlap for seamless transition
      }
    }
  },
  methods: {
    async openTranscript() {
      if (!this.transcriptFile) {
        this.error = 'No transcript file available for this item.'
        return
      }
      this.loading = true
      this.error = null
      // Start the initial window at currentTime (or at the beginning if near 0)
      await this.fetchWindow(Math.max(0, this.currentTime - 30), true)
      this.loading = false
    },

    /**
     * Fetches a window of subtitles from the server starting at `fromTime`.
     * @param {number} fromTime - Window start in seconds.
     * @param {boolean} [isInitial=false] - If true, replaces the entire window and resets state.
     */
    async fetchWindow(fromTime, isInitial = false) {
      if (this.isFetchingWindow) return
      if (!this.transcriptFile) return

      this.isFetchingWindow = true
      const from = Math.max(0, fromTime)
      const to = from + WINDOW_DURATION

      try {
        const response = await this.$axios.get(`/api/items/${this.libraryItemId}/transcript/${this.transcriptFile.ino}`, {
          params: { from, to }
        })

        const { subtitles, total } = response.data
        this.total = total

        if (isInitial || from >= this.windowTo || to <= this.windowFrom) {
          // Full replace: seeking to a new position or opening fresh
          this.window = subtitles
          this.windowFrom = from
          this.windowTo = to
          this.activeIndex = findActiveSubtitleIndex(this.window, this.currentTime)
          if (this.autoScroll && this.activeIndex !== -1) {
            this.$nextTick(() => this.$refs.scroller?.scrollToItem(this.activeIndex))
          }
        } else {
          // Append: prefetching the next adjacent window
          // Deduplicate by id before merging to avoid duplicates in the overlap zone
          const existingIds = new Set(this.window.map((s) => s.id))
          const newItems = subtitles.filter((s) => !existingIds.has(s.id))
          this.window = [...this.window, ...newItems]
          this.windowTo = to
        }
      } catch (err) {
        console.error('[PlayerTranscript] Failed to fetch transcript window:', err)
        if (isInitial) {
          this.error = 'Failed to load the transcript. Please try again.'
        }
      } finally {
        this.isFetchingWindow = false
      }
    },

    seekToSubtitle(startTime) {
      this.autoScroll = false
      this.$emit('seek', startTime)
      // Re-enable autoscroll after a short delay, then fetch window around new time
      setTimeout(async () => {
        await this.fetchWindow(Math.max(0, startTime - 30), true)
        this.autoScroll = true
      }, 300)
    },

    cleanup() {
      this.window = []
      this.windowFrom = 0
      this.windowTo = 0
      this.total = 0
      this.activeIndex = -1
      this.error = null
      this.isFetchingWindow = false
    },

    /**
     * Formats a number of seconds as H:MM:SS.
     * @param {number} seconds
     * @returns {string}
     */
    formatTime(seconds) {
      const h = Math.floor(seconds / 3600)
      const m = Math.floor((seconds % 3600) / 60)
      const s = Math.floor(seconds % 60)
      return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
    }
  }
}
</script>

<style scoped>
.transcript-container {
  max-height: calc(100vh - 8rem);
}

.transcript-item {
  height: 56px; /* must match ITEM_HEIGHT constant */
  overflow: hidden;
}
</style>
