import type { NewsItem } from "@shared/types"

interface Res {
  data: {
    type: "hot_list_feed"
    style_type: "1"
    feed_specific: {
      answer_count: 411
    }
    target: {
      title_area: {
        text: string
      }
      excerpt_area: {
        text: string
      }
      image_area: {
        url: string
      }
      metrics_area: {
        text: string
        font_color: string
        background: string
        weight: string
      }
      label_area: {
        type: "trend"
        trend: number
        night_color: string
        normal_color: string
      }
      link: {
        url: string
      }
    }
  }[]
}

interface APIRes {
  data: {
    detail_text?: string
    target: {
      id?: string | number
      title?: string
      url?: string
      excerpt?: string
    }
  }[]
}

async function fetchWebHot(): Promise<NewsItem[]> {
  const url = "https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=20&desktop=true"
  const res: Res = await myFetch(url, { timeout: 4000, retry: 0 })
  if (!Array.isArray(res?.data)) throw new Error("Cannot fetch Zhihu web hot list")
  return res.data.flatMap((item) => {
    const target = item?.target
    const link = target?.link?.url
    const title = target?.title_area?.text
    if (typeof link !== "string" || !/^https?:\/\//.test(link) || typeof title !== "string" || !title.trim()) return []
    return [{
      id: link.match(/(\d+)$/)?.[1] ?? link,
      title,
      url: link,
      extra: {
        info: target.metrics_area?.text,
        hover: target.excerpt_area?.text,
      },
    }]
  })
}

async function fetchAPIHot(): Promise<NewsItem[]> {
  // Zhihu's other hot-list endpoint returns questions rather than web cards.
  const url = "https://api.zhihu.com/topstory/hot-lists/total?limit=10&reverse_order=0"
  const res: APIRes = await myFetch(url, { timeout: 4000, retry: 0 })
  if (!Array.isArray(res?.data)) throw new Error("Cannot fetch Zhihu hot list")
  const news = res.data.flatMap((item) => {
    const target = item?.target
    const title = target?.title
    // Prefer the URL so a large question ID is never rounded as a JS number.
    const urlID = typeof target?.url === "string" ? /\/questions?\/(\d+)(?:[/?#]|$)/.exec(target.url)?.[1] : undefined
    const rawID = target?.id
    const id = urlID ?? (typeof rawID === "string" && /^\d+$/.test(rawID)
      ? rawID
      : typeof rawID === "number" && Number.isSafeInteger(rawID) && rawID > 0 ? String(rawID) : undefined)
    if (!id || typeof title !== "string" || !title.trim()) return []
    return [{
      id,
      title,
      url: `https://www.zhihu.com/question/${id}`,
      extra: {
        info: typeof item.detail_text === "string" ? item.detail_text : undefined,
        hover: typeof target.excerpt === "string" ? target.excerpt : undefined,
      },
    }]
  })
  if (!news.length) throw new Error("Cannot fetch Zhihu hot list")
  return news
}

export default defineSource({
  zhihu: async () => {
    const news = await fetchWebHot().catch(() => [])
    return news.length ? news : fetchAPIHot()
  },
})
