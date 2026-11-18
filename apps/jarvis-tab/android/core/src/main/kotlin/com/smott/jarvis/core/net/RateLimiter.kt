package com.smott.jarvis.core.net

import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** จำกัดจำนวนคำขอต่อช่วงเวลา (sliding window) ให้อยู่ในโควตาฟรีของแต่ละ API */
class RateLimiter(private val permits: Int, private val windowMs: Long) {
    private val mutex = Mutex()
    private val stamps = ArrayDeque<Long>()

    suspend fun acquire() {
        while (true) {
            val waitMs = mutex.withLock {
                val now = System.currentTimeMillis()
                while (stamps.isNotEmpty() && now - stamps.first() >= windowMs) stamps.removeFirst()
                if (stamps.size < permits) {
                    stamps.addLast(now)
                    0L
                } else {
                    windowMs - (now - stamps.first()) + 50L
                }
            }
            if (waitMs <= 0L) return
            delay(waitMs)
        }
    }
}
