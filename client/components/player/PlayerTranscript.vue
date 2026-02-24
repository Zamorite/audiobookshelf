<template>
  <div v-if="show" class="transcript-container absolute bottom-full left-0 md:left-20 right-0 z-40 bg-primary/95 overflow-hidden flex flex-col p-4 shadow-inner pointer-events-auto border-y border-gray-800">
    <!-- Header -->
    <div class="flex justify-between items-center mb-2 sticky top-0 bg-primary z-10 pb-2 border-b border-gray-700">
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">{{ $strings.LabelTranscript || 'Transcript' }}</h3>
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
    <recycle-scroller v-else ref="scroller" class="flex-grow" :items="window" :item-size="itemHeight" key-field="id">
      <template #default="{ item, index }">
        <div class="transcript-item flex flex-col justify-center items-start sm:flex-row sm:items-center sm:justify-start gap-1 sm:gap-2 cursor-pointer px-1 py-1 sm:py-2 rounded transition-colors duration-200" :class="activeIndex === index ? 'text-white font-medium bg-white/5' : 'text-gray-400 hover:text-gray-300'" @click="seekToSubtitle(item.start)">
          <span class="text-xs text-gray-500 sm:text-gray-600 sm:pt-0 shrink-0 w-14 sm:text-right select-none">{{ formatTime(item.start) }}</span>
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
const ITEM_HEIGHT_DESKTOP = 72
const ITEM_HEIGHT_MOBILE = 150

/** How many ms to look ahead for scrolling to compensate for latency. */
const SCROLL_ANTICIPATION_MS = 1000

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
      isFetchingWindow: false
    }
  },
  computed: {
    transcriptFile() {
      return this.libraryFiles.find((f) => f.metadata?.ext === '.srt')
    },
    itemHeight() {
      return this.$store.state.globals.isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT_DESKTOP
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

      const scrollIndex = findActiveSubtitleIndex(this.window, newTime + SCROLL_ANTICIPATION_MS / 1000)
      if (scrollIndex !== -1 && scrollIndex !== this.activeIndex) {
        this.activeIndex = scrollIndex
        if (this.autoScroll) {
          this.$nextTick(() => this.scrollToActive(this.activeIndex))
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
            this.$nextTick(() => this.scrollToActive(this.activeIndex))
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
    /**
     * Scrolls the virtual scroller to the given index, centering the item vertically.
     * @param {number} index
     */
    scrollToActive(index) {
      if (!this.$refs.scroller || index === -1) return
      const containerHeight = this.$refs.scroller.$el.clientHeight
      if (!containerHeight) return // Not yet rendered or hidden
      const targetPos = index * this.itemHeight - containerHeight / 2 + this.itemHeight / 2
      this.$refs.scroller.scrollToPosition(targetPos)
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
  height: calc(100vh - 16rem);
}
@media (min-width: 1024px) {
  .transcript-container {
    height: calc(100vh - 14rem);
  }
}

.transcript-item {
  height: 150px; /* ITEM_HEIGHT_MOBILE */
  overflow: hidden;
}

@media (min-width: 640px) {
  .transcript-item {
    height: 72px; /* ITEM_HEIGHT_DESKTOP */
  }
}

:deep(.vue-recycle-scroller) {
  scroll-behavior: smooth;
}
</style>
