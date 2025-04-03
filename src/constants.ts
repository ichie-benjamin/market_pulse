import { AssetCategory } from './models';

/**
 * Global allowed assets list
 * This controls which assets will be tracked across all providers
 */
export const ALLOWED_ASSETS: Record<AssetCategory, string[]> = {
    crypto: ["VETUSD","ALGOUSD","BSVUSD","BTCBUSD","EOSUSD","LINKUSD","UNIUSD","SOLUSD","MATICUSD","BTTUSD","NEOUSD","MKRUSD","TRXUSD","BCHUSD","FTTUSD","XTZUSD","ETCUSD","KLAYUSD","XMRUSD","DOGEUSD","KSMUSD","ETHUSD","DOTUSD","CAKEUSD","MIOTAUSD","XLMUSD","CROUSD","LEOUSD","FILUSD","AVAXUSD","LUNAUSD","XRPUSD","WBTCUSD","BTCUSD","USDTUSD","BNBUSD","LTCUSD","USDCUSD","GRTUSD","ADAUSD","ATOMUSD","AXSUSD","THETAUSD",
        "DASHUSD","DAIUSD","AAVEUSD","WAVESUSD","ICPUSD"],

    stocks: ["BMY","GM","CSCO","TMC","C","NRG","UBER","JPM","SAN",
        "MA","AAPL","CVX","MGM","NKE","ACN","DANOY","SHOP","DAL","MMM",
        "TWTR","FB","AZO","INTC","CMCSA","JNJ","TMO","VWAGY","GILD","TXN","AAP",
        "ADDYY","CRON","SIEGY","V","T","PFE","PYPL","MCD","AFL","TRIP","TSLA","NIO","BCS","AMAT",
        "MSFT","BMWYY","BABA","ADI","BAC","XOM","DELL","HSBC","CGC","BBVA","GS","WFC","DIS","EBAY",
        "RACE","AIG","SBUX","TSM","BA","MCO","BNPQF","SCGLY","GOOG","WIX","AVGO","ORCL","F","NEE",
        "MRNA","IBM","BIDU","NFLX","ALK","MCD","TEVA","KHC","BK","VZ","QCOM",
        "NVDA","MRK","MA","PG","ZM","AMZN","KO.N","LVMHF","ADBE"],

    forex: ["EURPLN","USDHKD","USDCHF","GBPCHF","NZDUSD","EURUSD",
        "SGDJPY","EURNOK","CADCHF","USDSGD","CADJPY","USDTRY","EURHUF","AUDUSD",
        "USDSEK","AUDCHF","AUDCAD","EURCHF","USDCNH","USDPLN","USDJPY","GBPUSD",
        "GBPJPY","USDHUF","GBPCAD","EURSEK","AUDJPY","USDMXN","USDNOK","ZARJPY",
        "EURCAD","USDZAR","CHFJPY","NZDJPY","USDDKK","USDCAD","NZDCHF","EURTRY",
        "NZDCAD","EURJPY"],

    indices: [
        'SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'EFA', 'EEM', 'VGK', 'VPL', 'SPX',
        'NDX', 'DJI', 'RUT'
    ],
    commodities: [
    'HEUSX', 'ZCUSX', 'ZQUSD', 'ALIUSD', 'ZBUSD', 'ZOUSX', 'PLUSD', 'ESUSD', 'ZMUSD',
    'GCUSD', 'ZLUSX', 'KEUSX', 'ZFUSD', 'SILUSD', 'HGUSD', 'MGCUSD', 'SBUSX', 'SIUSD',
    'CTUSX', 'DXUSD', 'ZSUSX', 'LBUSD', 'LEUSX', 'NGUSD', 'CLUSD', 'OJUSX', 'KCUSX',
    'PAUSD', 'GFUSX', 'ZTUSD', 'ZRUSD', 'CCUSD', 'NQUSD', 'ZNUSD', 'RTYUSD', 'BZUSD',
    'DCUSD', 'YMUSD', 'RBUSD', 'HOUSD'
    ]
};

/**
 * Get all allowed assets across all categories
 */
export function getAllAllowedAssets(): string[] {
    return Object.values(ALLOWED_ASSETS).flat();
}
