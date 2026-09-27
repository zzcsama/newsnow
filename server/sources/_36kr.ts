import type { NewsItem } from "@shared/types"
import { load } from "cheerio"
import dayjs from "dayjs/esm"

const requestOptions = {
  timeout: 4000,
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

  return news
})

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
  const initialState = response.match(/window\.initialState\s*=\s*(\{.*\})/)
  if (!initialState) return []
  try {
    const items = JSON.parse(initialState[1])?.hotListData?.topList
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

  const latest = await quick()
  if (!latest.length) throw new Error("36kr popularity list and newsflashes are unavailable")
  return latest.map(item => ({
    ...item,
    extra: {
      ...item.extra,
      info: "人气榜暂不可用，显示最新快讯",
    },
  }))
})

export default defineSource({
  "36kr": quick,
  "36kr-quick": quick,
  "36kr-renqi": renqi,
})
