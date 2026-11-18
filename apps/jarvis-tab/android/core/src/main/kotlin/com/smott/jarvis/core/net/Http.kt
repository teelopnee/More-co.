package com.smott.jarvis.core.net

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class HttpError(val code: Int, val host: String, val body: String) :
    IOException("HTTP $code จาก $host: ${body.take(300)}")

/** OkHttp แบบ suspend ที่ยกเลิกคำขอได้ทันทีเมื่อผู้ใช้กดหยุด */
class Http(val client: OkHttpClient) {

    suspend fun get(url: HttpUrl, headers: Map<String, String> = emptyMap(), maxBytes: Long? = null): String {
        val request = Request.Builder().url(url).get()
            .apply { headers.forEach { (k, v) -> header(k, v) } }
            .build()
        return execute(request, maxBytes)
    }

    suspend fun postJson(url: String, json: String, headers: Map<String, String> = emptyMap()): String {
        val request = Request.Builder().url(url).post(json.toRequestBody(JSON))
            .apply { headers.forEach { (k, v) -> header(k, v) } }
            .build()
        return execute(request, null)
    }

    private suspend fun execute(request: Request, maxBytes: Long?): String {
        val call = client.newCall(request)
        val response = suspendCancellableCoroutine<Response> { cont ->
            cont.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (cont.isActive) cont.resumeWithException(e)
                }

                override fun onResponse(call: Call, response: Response) {
                    if (cont.isActive) cont.resume(response) else response.close()
                }
            })
        }
        return withContext(Dispatchers.IO) {
            response.use { resp ->
                val body = resp.body
                val text = when {
                    body == null -> ""
                    maxBytes != null -> {
                        val source = body.source()
                        source.request(maxBytes)
                        source.buffer.readUtf8(minOf(maxBytes, source.buffer.size))
                    }
                    else -> body.string()
                }
                if (!resp.isSuccessful) throw HttpError(resp.code, request.url.host, text)
                text
            }
        }
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

/** ลองใหม่เมื่อเครือข่ายสะดุด หรือเซิร์ฟเวอร์ตอบ 429/5xx */
suspend fun <T> withRetry(retries: Int = 2, block: suspend () -> T): T {
    var attempt = 0
    while (true) {
        try {
            return block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpError) {
            val retryable = e.code == 429 || e.code >= 500
            if (!retryable || attempt >= retries) throw e
            delay(if (e.code == 429) 2_500L * (attempt + 1) else 1_200L * (attempt + 1))
        } catch (e: IOException) {
            if (attempt >= retries) throw e
            delay(1_000L * (attempt + 1))
        }
        attempt++
    }
}

/** เหมือน runCatching แต่ไม่กลืนการยกเลิก coroutine */
inline fun <T> resultOf(block: () -> T): Result<T> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    Result.failure(e)
}
