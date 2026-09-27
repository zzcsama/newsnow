import type { NewsItem } from "@shared/types"
import { load } from "cheerio"
import dayjs from "dayjs/esm"

const requestOptions = {
  timeout: 2000,
  retry: 0,
  responseType: "text" as const,
  headers: {
    Referer: "https://www.36kr.com/",
    Accept: "text/html,application/xhtml+xml",
  },
}

const quick = defineSource(async () => {
  const baseURL = "https://www.36kr.com"
  const url = `${baseURL}/newsflashes`
  const response = await myFetch(url, requestOptions) as string
  const $ = load(response)
  const news: NewsItem[] = []
  const $items = $(".newsflash-item")
  $items.each((_, el) => {
    const $el = $(el)
    const $a = $el.find("a.item-title")
    const url = $a.attr("href")
    const title = $a.text()
    const relativeDate = $el.find(".time").text()
    if (url && title && relativeDate) {
      news.push({
        url: `${baseURL}${url}`,
        title,
        id: url,
        extra: {
          date: parseRelativeDate(relativeDate, "Asia/Shanghai").valueOf(),
        },
      })
    }
  })

  if (news.length) return news
  // The official page can deliver its list as server-rendered page data.
  const items = parseInitialState(response)?.newsflashCatalogData?.data?.newsflashList?.data?.itemList
  return mapNewsflashes(items)
})

function mapNewsflashes(items: unknown): NewsItem[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item): NewsItem[] => {
    const flash = item?.templateMaterial ?? item
    const id = flash?.itemId
    const title = typeof flash?.widgetTitle === "string" ? flash.widgetTitle.replace(/<\/?em>/g, "").trim() : ""
    if (!title || !(typeof id === "string" ? /^\d+$/.test(id) : Number.isSafeInteger(id) && id > 0)) return []
    return [{
      id: `/newsflashes/${id}`,
      title,
      url: `https://www.36kr.com/newsflashes/${id}`,
      extra: {
        date: typeof flash.publishTime === "number" && Number.isFinite(flash.publishTime) ? flash.publishTime : undefined,
      },
    }]
  })
}

async function fetchGatewayNewsflashes(): Promise<NewsItem[]> {
  // Reproduce the official anonymous web client's request with a fresh public nonce.
  const html = await myFetch("https://www.36kr.com/rss-center", { ...requestOptions, timeout: 1500 }) as string
  const nonce = /window\.__GATEWAY_SIGN__\s*=\s*["']([^"']+)["']/.exec(html)?.[1]
  if (!nonce || html.includes("_wafchallenge")) return []
  const body = JSON.stringify({
    nonce,
    partner_id: "web",
    timestamp: Date.now(),
    param: { pageSize: 20, pageEvent: 0, pageCallback: "", siteId: 1, type: 0, platformId: 2 },
  })
  const sign = await md5(body + nonce)
  const response: { code?: number, data?: { itemList?: unknown } } = await myFetch(`https://gateway.36kr.com/api/mis/nav/newsflash/list?sign=${sign}`, {
    timeout: 2000,
    retry: 0,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
  return response?.code === 0 ? mapNewsflashes(response.data?.itemList) : []
}

function parseInitialState(response: string) {
  const initialState = response.match(/window\.initialState\s*=\s*(\{.*\})/)
  if (!initialState) return
  try {
    return JSON.parse(initialState[1])
  } catch {
    return undefined
  }
}

function parsePopularityHtml(response: string): NewsItem[] {
  const baseURL = "https://36kr.com"
  const $ = load(response)
  const articles: NewsItem[] = []

  // 单条新闻选择器
  const $items = $(".article-item-info")

  $items.each((_, el) => {
    const $el = $(el)

    // 标题和链接
    const $a = $el.find("a.article-item-title.weight-bold")
    const href = $a.attr("href") || ""
    const title = $a.text().trim()

    const description = $el.find("a.article-item-description.ellipsis-2").text().trim()

    // 作者
    const author = $el.find(".kr-flow-bar-author").text().trim()

    // 热度
    const hot = $el.find(".kr-flow-bar-hot span").text().trim()

    if (href && title) {
      articles.push({
        url: href.startsWith("http") ? href : `${baseURL}${href}`,
        title,
        id: href.slice(3), // 简化处理
        // url.slice(url.lastIndexOf("/") + 1)
        extra: {
          info: `${author}  |  ${hot}`,
          hover: description,
        },
      })
    }
  })
  if (articles.length) return articles

  // The official catalog embeds the same popularity list in page data.
  try {
    const items = parseInitialState(response)?.hotListData?.topList
    if (!Array.isArray(items)) return []
    return items.filter(item => item.itemType !== 0).map((item) => {
      const article = item.templateMaterial ?? item
      return {
        id: String(article.itemId ?? ""),
        title: String(article.widgetTitle ?? "").replace(/<\/?em>/g, ""),
        url: `${baseURL}/p/${article.itemId}`,
        extra: {
          info: article.authorName,
          hover: article.summary,
        },
      }
    }).filter(item => item.id && item.title)
  } catch {
    return []
  }
}

const renqi = defineSource(async () => {
  // Use the source's calendar day even when the Worker runs in UTC.
  const formatted = dayjs(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const urls = [
    `https://36kr.com/hot-list/renqi/${formatted}/1`,
    "https://www.36kr.com/hot-list/catalog",
  ]

  for (const url of urls) {
    try {
      const response = await myFetch(url, requestOptions) as string
      const articles = parsePopularityHtml(response)
      if (articles.length) return articles
    } catch {
      // Try the next official source when the request is blocked or unavailable.
    }
  }

  const latest = await quick().catch(() => [])
  if (latest.length) return latest.map(item => ({
    ...item,
    extra: {
      ...item.extra,
      info: "人气榜暂不可用，显示最新快讯",
    },
  }))

  // The official RSS mixes articles and newsflashes, not popularity-ranked news.
  const feed = await rss2json("https://www.36kr.com/feed", { timeout: 2000, retry: 0 }).catch(() => undefined)
  const articles = (feed?.items ?? []).filter(item => typeof item.title === "string" && item.title.trim()
    && typeof item.link === "string" && /^https?:\/\/(?:www\.)?36kr\.com\/(?:p|newsflashes)\/\d+(?:[/?#]|$)/.test(item.link))
    .map((item) => {
      const isoDate = typeof item.created === "string"
        ? item.created.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s+([+-]\d{2})(\d{2})$/, "$1T$2$3:$4")
        : ""
      const date = Date.parse(isoDate)
      return {
        id: item.link,
        title: item.title,
        url: item.link,
        pubDate: Number.isFinite(date) ? date : undefined,
        extra: { info: "人气榜暂不可用，显示最新资讯（官方RSS）" },
      }
    }).sort((a, b) => {
      if (a.pubDate === undefined) return b.pubDate === undefined ? 0 : 1
      if (b.pubDate === undefined) return -1
      return b.pubDate - a.pubDate
    })
  if (articles.length) return articles

  // All attempts total at most 11.5 seconds of network timeout, with no retries.
  const gatewayNews = await fetchGatewayNewsflashes().catch(() => [])
  if (gatewayNews.length) return gatewayNews.map(item => ({
    ...item,
    extra: { ...item.extra, info: "人气榜暂不可用，显示最新快讯" },
  }))
  throw new Error("36kr popularity list, newsflashes and official feed are unavailable")
})

export default defineSource({
  "36kr": quick,
  "36kr-quick": quick,
  "36kr-renqi": renqi,
})
