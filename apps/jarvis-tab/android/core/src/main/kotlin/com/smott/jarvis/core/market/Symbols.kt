package com.smott.jarvis.core.market

private val SYMBOL = Regex("^[A-Z0-9][A-Z0-9.\\-:/=^]{0,14}$")

fun normalizeSymbol(raw: String): String = raw.trim().removePrefix("$").uppercase()

fun isValidSymbol(symbol: String): Boolean = SYMBOL.matches(symbol)
