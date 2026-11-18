package com.smott.jarvis.core.keys

import com.smott.jarvis.core.net.Http
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** คำตอบจริงของแต่ละเจ้าเมื่อคีย์ผิด เก็บจากการลองยิงจริง (18 พ.ย. 2026) */
class KeyCheckerTest {
    private fun checker(respond: (host: String, path: String, auth: String?) -> Pair<Int, String>): KeyChecker {
        val http = Http(OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
            val req = chain.request()
            val auth = req.header("Authorization") ?: req.header("X-Finnhub-Token") ?: req.url.queryParameter("apikey")
            val (code, body) = respond(req.url.host, req.url.encodedPath, auth)
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("x")
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }).build())
        return KeyChecker(http)
    }

    private val good = checker { host, path, auth ->
        val bad = auth == null || "bad" in auth
        when {
            host == "generativelanguage.googleapis.com" && bad ->
                400 to """[{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}]"""
            host == "generativelanguage.googleapis.com" && "suspended" in auth!! ->
                403 to """{"error":{"code":403,"message":"Permission denied: Consumer 'projects/1' has been suspended.","status":"PERMISSION_DENIED"}}"""
            host == "generativelanguage.googleapis.com" ->
                200 to """{"data":[{"id":"models/gemini-3.8-flash"},{"id":"models/gemini-3.5-flash-lite"},{"id":"models/gemini-embedding-2"}]}"""
            host == "openrouter.ai" && bad -> 401 to """{"error":{"message":"User not found.","code":401}}"""
            host == "openrouter.ai" -> 200 to """{"data":{"label":"sk-or-v1-abc","usage":0,"limit":null,"limit_remaining":null,"is_free_tier":true}}"""
            host == "api.tavily.com" && bad -> 401 to """{"detail":{"error":"Unauthorized: missing or invalid API key."}}"""
            host == "api.tavily.com" -> 200 to """{"key":{"usage":12,"limit":1000},"account":{"current_plan":"Researcher","plan_usage":12,"plan_limit":1000}}"""
            host == "finnhub.io" && bad -> 401 to """{"error":"Invalid API key."}"""
            host == "finnhub.io" -> 200 to """{"c":271.5,"d":1,"dp":0.4,"h":272,"l":269,"o":270,"pc":270.5,"t":1794850000}"""
            host == "api.twelvedata.com" && bad ->
                401 to """{"code":401,"message":"**apikey** parameter is incorrect or not specified.","status":"error"}"""
            host == "api.twelvedata.com" -> 200 to """{"timestamp":"2026-11-18 13:37:39","current_usage":1,"plan_limit":8,"daily_usage":5,"plan_daily_limit":800,"plan_category":"basic"}"""
            else -> 404 to "{}"
        }
    }

    @Test
    fun goodKeysShowUsefulDetails() = runBlocking {
        val g = good.check(KeyService.GEMINI, " AIza-good ")
        assertTrue(g.ok); assertTrue("gemini-3.8-flash" in g.message, g.message)
        val o = good.check(KeyService.OPENROUTER, "sk-or-good")
        assertTrue(o.ok); assertTrue("บัญชีฟรี" in o.message, o.message)
        val t = good.check(KeyService.TAVILY, "tvly-good")
        assertEquals(KeyCheck(true, "ใช้ได้ · เดือนนี้ใช้ไป 12/1000 เครดิต"), t)
        val f = good.check(KeyService.FINNHUB, "fh-good")
        assertTrue(f.ok); assertTrue("271.50" in f.message, f.message)
        assertEquals(KeyCheck(true, "ใช้ได้ · วันนี้ใช้ไป 5/800 ครั้ง"), good.check(KeyService.TWELVE_DATA, "td-good"))
        println(listOf(g, o, t, f).joinToString("\n"))
    }

    @Test
    fun badKeysAreExplained() = runBlocking {
        for (s in KeyService.entries) {
            val r = good.check(s, "bad-key")
            println("$s → $r")
            assertFalse(r.ok, "$s")
            assertTrue("คีย์ไม่ถูกต้อง" in r.message, "$s: ${r.message}")
        }
        val suspended = good.check(KeyService.GEMINI, "suspended-key")
        assertFalse(suspended.ok)
        assertTrue("ระงับ" in suspended.message)
        assertEquals(KeyCheck(false, "ยังไม่ได้ใส่คีย์"), good.check(KeyService.TAVILY, "  "))
    }
}
