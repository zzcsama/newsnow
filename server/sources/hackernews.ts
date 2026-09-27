import * as cheerio from "cheerio"
import type { NewsItem } from "@shared/types"

const baseURL = "https://news.ycombinator.com"

async function fetchDirect(): Promise<NewsItem[]> {
  const html: any = await myFetch(baseURL, { timeout: 4000, retry: 0 })
  const $ = cheerio.load(html)
  const $main = $(".athing")
  const news: NewsItem[] = []
  $main.each((_, el) => {
    const a = $(el).find(".titleline a").first()
    // const url = a.attr("href")
    const title = a.text()
    const id = $(el).attr("id")
    const score = $(`#score_${id}`).text()
    const url = `${baseURL}/item?id=${id}`
    if (url && id && title) {
      news.push({
        url,
        title,
        id,
        extra: {
          info: score,
        },
      })
    }
  })
  return news
}

interface HackerNewsItem {
  id: number
  title?: string
  score?: number
  time?: number
  deleted?: boolean
  dead?: boolean
}

async function fetchViaAPI(): Promise<NewsItem[]> {
  const apiURL = "https://hacker-news.firebaseio.com/v0"
  const data: unknown = await myFetch(`${apiURL}/topstories.json`, { timeout: 2000, retry: 0 })
  if (!Array.isArray(data)) throw new Error("Cannot fetch Hacker News top stories")
  // At most 32 subrequests including the primary page, within the free Worker limit.
  const ids = [...new Set(data.filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 30)
  const items = await Promise.all(ids.map(async (id): Promise<NewsItem | undefined> => {
    try {
      const item: HackerNewsItem = await myFetch(`${apiURL}/item/${id}.json`, { timeout: 4000, retry: 0 })
      if (item?.id !== id || item.deleted || item.dead || typeof item.title !== "string") return
      const title = cheerio.load(item.title).text().trim()
      if (!title) return
      return {
        id: String(id),
        title,
        url: `${baseURL}/item?id=${id}`,
        pubDate: typeof item.time === "number" && Number.isFinite(item.time) ? item.time * 1000 : undefined,
        extra: typeof item.score === "number" ? { info: `${item.score} points` } : undefined,
      }
    } catch {
      // One unavailable item should not discard the remaining ranked stories.
    }
  }))
  const news = items.filter((item): item is NewsItem => !!item)
  if (!news.length) throw new Error("Cannot fetch Hacker News API data")
  return news
}

export default defineSource(async () => {
  const news = await fetchDirect().catch(() => [])
  return news.length ? news : fetchViaAPI()
})
