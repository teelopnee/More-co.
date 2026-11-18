package com.smott.jarvis.data

import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.model.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/** เก็บเซสชัน (คำถาม + คำตอบ + ข้อมูลกราฟ) เป็นไฟล์ JSON ในเครื่อง */
class SessionStore(private val dir: File) {
    private val mutex = Mutex()

    suspend fun save(session: Session) {
        if (session.turns.isEmpty()) return
        withContext(Dispatchers.IO) {
            mutex.withLock {
                dir.mkdirs()
                val target = File(dir, "${session.id}.json")
                val tmp = File(dir, "${session.id}.json.tmp")
                tmp.writeText(JarvisJson.encodeToString(Session.serializer(), session))
                if (!tmp.renameTo(target)) {
                    target.delete()
                    tmp.renameTo(target)
                }
            }
        }
    }

    suspend fun load(id: String): Session? = withContext(Dispatchers.IO) {
        read(File(dir, "$id.json"))
    }

    suspend fun list(limit: Int = 50): List<Session> = withContext(Dispatchers.IO) {
        dir.listFiles { f -> f.name.endsWith(".json") }.orEmpty()
            .sortedByDescending { it.lastModified() }
            .take(limit)
            .mapNotNull { read(it) }
    }

    suspend fun latest(): Session? = list(1).firstOrNull()

    suspend fun delete(id: String) {
        withContext(Dispatchers.IO) { mutex.withLock { File(dir, "$id.json").delete() } }
    }

    private fun read(file: File): Session? = runCatching {
        JarvisJson.decodeFromString(Session.serializer(), file.readText())
    }.getOrNull()
}
