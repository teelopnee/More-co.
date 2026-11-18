package com.smott.jarvis.core.tools

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class VideoRefTest {
    @Test
    fun parsesCommonVideoLinks() {
        val yt = VideoRef(VideoRef.YOUTUBE, "dQw4w9WgXcQ")
        assertEquals(yt, VideoRef.parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"))
        assertEquals(yt, VideoRef.parse("https://youtu.be/dQw4w9WgXcQ?si=abc"))
        assertEquals(yt, VideoRef.parse("https://m.youtube.com/shorts/dQw4w9WgXcQ"))
        assertEquals(yt, VideoRef.parse("https://www.youtube.com/embed/dQw4w9WgXcQ"))
        assertEquals(yt, VideoRef.parse("https://www.youtube.com/live/dQw4w9WgXcQ"))
        assertEquals(VideoRef(VideoRef.TIKTOK, "7212345678901234567"), VideoRef.parse("https://www.tiktok.com/@user/video/7212345678901234567?lang=th"))
        assertEquals("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", yt.thumbnail)
    }

    @Test
    fun rejectsNonVideoLinks() {
        assertNull(VideoRef.parse("https://www.youtube.com/@channel"))
        assertNull(VideoRef.parse("https://www.youtube.com/watch?v=short"))
        assertNull(VideoRef.parse("https://www.tiktok.com/@user"))
        assertNull(VideoRef.parse("https://example.com/watch?v=dQw4w9WgXcQ"))
        assertNull(VideoRef.parse("not a url"))
    }
}
