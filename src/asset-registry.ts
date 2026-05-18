import fs from 'node:fs/promises'
import path from 'node:path'
import axios from 'axios'
import { ALLOWED_ASSETS, AllowedAsset } from './constants'
import { AssetCategory } from './models'
import { API_CONFIG, mapToTwelvedataSymbol } from './providers/twelvedata/constants'
import { config } from './config'
import { createLogger } from './logging'

const logger = createLogger('asset-registry')

const CATEGORIES: AssetCategory[] = ['crypto', 'stocks', 'forex', 'indices', 'commodities', 'metals']

interface AssetOverride {
    displayName: string | null
    tv_sym: string | null
}

interface AssetRegistryState {
    custom: Record<AssetCategory, AllowedAsset[]>
    overrides: Record<AssetCategory, Record<string, AssetOverride>>
    removals: Record<AssetCategory, string[]>
}

export interface AssetRegistryCategoryView {
    category: AssetCategory
    effective: AllowedAsset[]
    custom: AllowedAsset[]
    removals: string[]
    overrides: Record<string, AssetOverride>
}

export interface AssetRegistryView {
    categories: Record<AssetCategory, AssetRegistryCategoryView>
}

export interface ValidateAssetResult {
    provider: 'twelvedata'
    category: AssetCategory
    requestedSymbol: string
    wireSymbol: string | null
    available: boolean
    providerSymbol?: string
    providerName?: string
    price?: number
    reason?: string
}

const baseAssetsSnapshot: Record<AssetCategory, AllowedAsset[]> = CATEGORIES.reduce((acc, category) => {
    acc[category] = ALLOWED_ASSETS[category].map((asset) => ({ ...asset }))
    return acc
}, {} as Record<AssetCategory, AllowedAsset[]>)

const registryFilePath = process.env.CUSTOM_ASSETS_FILE || path.join(process.cwd(), 'data', 'custom-assets.json')

let state: AssetRegistryState = createEmptyState()
let initialized = false

function createEmptyState(): AssetRegistryState {
    const custom = {} as Record<AssetCategory, AllowedAsset[]>
    const overrides = {} as Record<AssetCategory, Record<string, AssetOverride>>
    const removals = {} as Record<AssetCategory, string[]>

    for (const category of CATEGORIES) {
        custom[category] = []
        overrides[category] = {}
        removals[category] = []
    }

    return { custom, overrides, removals }
}

function normalizeSymbol(symbol: string): string {
    return symbol.trim().toUpperCase().replace(/\s+/g, '')
}

function normalizeNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const cleaned = value.trim()
    return cleaned.length > 0 ? cleaned : null
}

function sanitizeAllowedAsset(asset: unknown): AllowedAsset | null {
    if (!asset || typeof asset !== 'object') {
        return null
    }

    const raw = asset as Partial<AllowedAsset>
    if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
        return null
    }

    return {
        name: normalizeSymbol(raw.name),
        displayName: normalizeNullableString(raw.displayName),
        tv_sym: normalizeNullableString(raw.tv_sym)
    }
}

function sanitizeState(raw: unknown): AssetRegistryState {
    const clean = createEmptyState()

    if (!raw || typeof raw !== 'object') {
        return clean
    }

    const source = raw as Partial<AssetRegistryState>

    for (const category of CATEGORIES) {
        const rawCustom = source.custom?.[category]
        if (Array.isArray(rawCustom)) {
            const deduped = new Map<string, AllowedAsset>()
            for (const item of rawCustom) {
                const sanitized = sanitizeAllowedAsset(item)
                if (!sanitized) continue
                deduped.set(sanitized.name, sanitized)
            }
            clean.custom[category] = Array.from(deduped.values())
        }

        const rawOverrides = source.overrides?.[category]
        if (rawOverrides && typeof rawOverrides === 'object') {
            for (const [symbol, override] of Object.entries(rawOverrides)) {
                const normalizedSymbol = normalizeSymbol(symbol)
                const displayName = normalizeNullableString((override as AssetOverride).displayName)
                const tvSym = normalizeNullableString((override as AssetOverride).tv_sym)
                clean.overrides[category][normalizedSymbol] = {
                    displayName,
                    tv_sym: tvSym
                }
            }
        }

        const rawRemovals = source.removals?.[category]
        if (Array.isArray(rawRemovals)) {
            const symbols = rawRemovals
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                .map((symbol) => normalizeSymbol(symbol))
            clean.removals[category] = Array.from(new Set(symbols))
        }
    }

    return clean
}

function buildEffectiveCategoryAssets(category: AssetCategory): AllowedAsset[] {
    const removed = new Set(state.removals[category])
    const map = new Map<string, AllowedAsset>()

    for (const baseAsset of baseAssetsSnapshot[category]) {
        if (removed.has(baseAsset.name)) continue
        const override = state.overrides[category][baseAsset.name]
        map.set(baseAsset.name, {
            name: baseAsset.name,
            displayName: override ? override.displayName : baseAsset.displayName,
            tv_sym: override ? override.tv_sym : baseAsset.tv_sym
        })
    }

    for (const customAsset of state.custom[category]) {
        if (removed.has(customAsset.name)) continue
        map.set(customAsset.name, { ...customAsset })
    }

    return Array.from(map.values())
}

function applyStateToAllowedAssets(): void {
    for (const category of CATEGORIES) {
        ALLOWED_ASSETS[category] = buildEffectiveCategoryAssets(category)
    }
}

async function persistState(): Promise<void> {
    const dir = path.dirname(registryFilePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(registryFilePath, JSON.stringify(state, null, 2), 'utf-8')
}

export async function initializeAssetRegistry(): Promise<void> {
    if (initialized) {
        return
    }

    try {
        const fileContent = await fs.readFile(registryFilePath, 'utf-8')
        state = sanitizeState(JSON.parse(fileContent))
        logger.info('Loaded asset registry overrides', { file: registryFilePath })
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            state = createEmptyState()
            logger.info('Asset registry file not found; using defaults', { file: registryFilePath })
        } else {
            logger.error('Failed to load asset registry file; using defaults', {
                file: registryFilePath,
                error
            })
            state = createEmptyState()
        }
    }

    applyStateToAllowedAssets()
    initialized = true
}

function assertInitialized(): void {
    if (!initialized) {
        throw new Error('Asset registry is not initialized')
    }
}

export function isValidCategory(category: string): category is AssetCategory {
    return CATEGORIES.includes(category as AssetCategory)
}

export function getAssetRegistryView(category?: AssetCategory): AssetRegistryView | AssetRegistryCategoryView {
    assertInitialized()

    if (category) {
        return {
            category,
            effective: ALLOWED_ASSETS[category].map((asset) => ({ ...asset })),
            custom: state.custom[category].map((asset) => ({ ...asset })),
            removals: [...state.removals[category]],
            overrides: { ...state.overrides[category] }
        }
    }

    const categories = {} as Record<AssetCategory, AssetRegistryCategoryView>
    for (const cat of CATEGORIES) {
        categories[cat] = {
            category: cat,
            effective: ALLOWED_ASSETS[cat].map((asset) => ({ ...asset })),
            custom: state.custom[cat].map((asset) => ({ ...asset })),
            removals: [...state.removals[cat]],
            overrides: { ...state.overrides[cat] }
        }
    }

    return { categories }
}

export async function addAssetToRegistry(input: {
    category: AssetCategory
    symbol: string
    displayName?: string | null
    tv_sym?: string | null
}): Promise<AllowedAsset> {
    assertInitialized()

    const category = input.category
    const symbol = normalizeSymbol(input.symbol)

    const exists = ALLOWED_ASSETS[category].some((asset) => asset.name === symbol)
    if (exists) {
        throw new Error(`Asset already exists in category ${category}: ${symbol}`)
    }

    const customAsset: AllowedAsset = {
        name: symbol,
        displayName: normalizeNullableString(input.displayName),
        tv_sym: normalizeNullableString(input.tv_sym)
    }

    state.custom[category].push(customAsset)
    state.custom[category] = dedupeAssetsByName(state.custom[category])
    state.removals[category] = state.removals[category].filter((item) => item !== symbol)

    applyStateToAllowedAssets()
    await persistState()
    return customAsset
}

function dedupeAssetsByName(assets: AllowedAsset[]): AllowedAsset[] {
    const map = new Map<string, AllowedAsset>()
    for (const asset of assets) {
        map.set(asset.name, asset)
    }
    return Array.from(map.values())
}

export async function updateAssetInRegistry(input: {
    category: AssetCategory
    symbol: string
    newSymbol?: string
    displayName?: string | null
    tv_sym?: string | null
}): Promise<{ updated: AllowedAsset; source: 'custom' | 'default' }> {
    assertInitialized()

    const category = input.category
    const currentSymbol = normalizeSymbol(input.symbol)
    const customIndex = state.custom[category].findIndex((asset) => asset.name === currentSymbol)
    const nextSymbol = input.newSymbol ? normalizeSymbol(input.newSymbol) : currentSymbol

    const hasDisplayName = Object.prototype.hasOwnProperty.call(input, 'displayName')
    const hasTvSym = Object.prototype.hasOwnProperty.call(input, 'tv_sym')

    if (customIndex >= 0) {
        const symbolTaken = nextSymbol !== currentSymbol && ALLOWED_ASSETS[category].some((asset) => asset.name === nextSymbol)
        if (symbolTaken) {
            throw new Error(`Asset symbol already exists in category ${category}: ${nextSymbol}`)
        }

        const current = state.custom[category][customIndex]
        const updated: AllowedAsset = {
            name: nextSymbol,
            displayName: hasDisplayName ? normalizeNullableString(input.displayName) : current.displayName,
            tv_sym: hasTvSym ? normalizeNullableString(input.tv_sym) : current.tv_sym
        }

        state.custom[category][customIndex] = updated
        state.custom[category] = dedupeAssetsByName(state.custom[category])
        state.removals[category] = state.removals[category].filter((item) => item !== nextSymbol)

        applyStateToAllowedAssets()
        await persistState()

        return { updated, source: 'custom' }
    }

    const baseExists = baseAssetsSnapshot[category].some((asset) => asset.name === currentSymbol)
    if (!baseExists) {
        throw new Error(`Asset not found in category ${category}: ${currentSymbol}`)
    }

    if (nextSymbol !== currentSymbol) {
        throw new Error('Renaming a default asset is not allowed. Add a custom asset instead.')
    }

    const fallback = baseAssetsSnapshot[category].find((asset) => asset.name === currentSymbol)!
    const override = state.overrides[category][currentSymbol] || {
        displayName: fallback.displayName,
        tv_sym: fallback.tv_sym
    }

    const nextOverride: AssetOverride = {
        displayName: hasDisplayName ? normalizeNullableString(input.displayName) : override.displayName,
        tv_sym: hasTvSym ? normalizeNullableString(input.tv_sym) : override.tv_sym
    }

    state.overrides[category][currentSymbol] = nextOverride
    applyStateToAllowedAssets()
    await persistState()

    const updated = ALLOWED_ASSETS[category].find((asset) => asset.name === currentSymbol)
    return {
        updated: updated || {
            name: currentSymbol,
            displayName: nextOverride.displayName,
            tv_sym: nextOverride.tv_sym
        },
        source: 'default'
    }
}

export async function removeAssetFromRegistry(input: {
    category: AssetCategory
    symbol: string
}): Promise<{ removed: string; source: 'custom' | 'default' | 'none' }> {
    assertInitialized()

    const category = input.category
    const symbol = normalizeSymbol(input.symbol)

    const customIndex = state.custom[category].findIndex((asset) => asset.name === symbol)
    if (customIndex >= 0) {
        state.custom[category].splice(customIndex, 1)
        delete state.overrides[category][symbol]
        applyStateToAllowedAssets()
        await persistState()
        return { removed: symbol, source: 'custom' }
    }

    const baseExists = baseAssetsSnapshot[category].some((asset) => asset.name === symbol)
    if (!baseExists) {
        return { removed: symbol, source: 'none' }
    }

    if (!state.removals[category].includes(symbol)) {
        state.removals[category].push(symbol)
    }
    delete state.overrides[category][symbol]
    applyStateToAllowedAssets()
    await persistState()

    return { removed: symbol, source: 'default' }
}

function extractSingleQuotePayload(payload: any, wireSymbol: string): any | null {
    if (!payload || typeof payload !== 'object') return null

    if (payload.status === 'error') return payload
    if (payload.symbol || payload.close || payload.price) return payload

    const fromKey = payload[wireSymbol]
    if (fromKey && typeof fromKey === 'object') {
        return fromKey
    }

    return null
}

export async function validateAssetWithTwelveData(input: {
    category: AssetCategory
    symbol: string
}): Promise<ValidateAssetResult> {
    const normalizedSymbol = normalizeSymbol(input.symbol)
    const wireSymbol = mapToTwelvedataSymbol(normalizedSymbol, input.category)

    if (!wireSymbol) {
        return {
            provider: 'twelvedata',
            category: input.category,
            requestedSymbol: normalizedSymbol,
            wireSymbol: null,
            available: false,
            reason: 'No Twelvedata symbol mapping available for this asset'
        }
    }

    const apiKey = config.apiKeys.twelvedata
    if (!apiKey) {
        return {
            provider: 'twelvedata',
            category: input.category,
            requestedSymbol: normalizedSymbol,
            wireSymbol,
            available: false,
            reason: 'TWELVEDATA_API_KEY is not configured'
        }
    }

    try {
        const response = await axios.get(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.quote}`, {
            params: {
                symbol: wireSymbol,
                apikey: apiKey
            },
            timeout: API_CONFIG.requestTimeoutMs
        })

        const payload = extractSingleQuotePayload(response.data, wireSymbol)
        if (!payload) {
            return {
                provider: 'twelvedata',
                category: input.category,
                requestedSymbol: normalizedSymbol,
                wireSymbol,
                available: false,
                reason: 'Empty or unrecognized response from Twelvedata'
            }
        }

        if (payload.status === 'error') {
            return {
                provider: 'twelvedata',
                category: input.category,
                requestedSymbol: normalizedSymbol,
                wireSymbol,
                available: false,
                reason: payload.message || 'Twelvedata returned an error'
            }
        }

        const numericPrice = Number(payload.close ?? payload.price ?? payload.previous_close)
        return {
            provider: 'twelvedata',
            category: input.category,
            requestedSymbol: normalizedSymbol,
            wireSymbol,
            available: Number.isFinite(numericPrice),
            providerSymbol: payload.symbol || wireSymbol,
            providerName: payload.name,
            price: Number.isFinite(numericPrice) ? numericPrice : undefined,
            reason: Number.isFinite(numericPrice) ? undefined : 'No valid price returned from Twelvedata'
        }
    } catch (error: any) {
        const message = error?.response?.data?.message || error?.message || 'Unknown validation error'
        logger.error('Twelvedata validation request failed', {
            category: input.category,
            symbol: normalizedSymbol,
            wireSymbol,
            message
        })

        return {
            provider: 'twelvedata',
            category: input.category,
            requestedSymbol: normalizedSymbol,
            wireSymbol,
            available: false,
            reason: message
        }
    }
}

