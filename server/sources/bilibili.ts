import type { NewsItem } from "@shared/types"

interface WapRes {
  code: number
  exp_str: string
  list: {
    hot_id: number
    keyword: string
    show_name: string
    score: number
    word_type: number
    goto_type: number
    goto_value: string
    icon: string
    live_id: any[]
    call_reason: number
    heat_layer: string
    pos: number
    id: number
    status: string
    name_type: string
    resource_id: number
    set_gray: number
    card_values: any[]
    heat_score: number
    stat_datas: {
      etime: string
      stime: string
      is_commercial: string
    }
  }[]
  top_list: any[]
  hotword_egg_info: string
  seid: string
  timestamp: number
  total_count: number
}

// Interface for Bilibili Hot Video response
interface HotVideoRes {
  code: number
  message: string
  ttl: number
  data: {
    list: {
      aid: number
      videos: number
      tid: number
      tname: string
      copyright: number
      pic: string
      title: string
      pubdate: number
      ctime: number
      desc: string
      state: number
      duration: number
      owner: {
        mid: number
        name: string
        face: string
      }
      stat: {
        view: number
        danmaku: number
        reply: number
        favorite: number
        coin: number
        share: number
        now_rank: number
        his_rank: number
        like: number
        dislike: number
      }
      dynamic: string
      cid: number
      dimension: {
        width: number
        height: number
        rotate: number
      }
      short_link: string
      short_link_v2: string
      bvid: string
      rcmd_reason: {
        content: string
        corner_mark: number
      }
    }[]
  }
}

interface HotSearchEntry {
  keyword: string
  show_name?: string
  icon?: string
}

interface SquareRes {
  code: number
  data?: {
    trending?: {
      list?: HotSearchEntry[]
    }
  }
}

interface AppHotSearchRes {
  code: number
  data?: {
    list?: HotSearchEntry[]
  }
}

function mapHotSearch(items: HotSearchEntry[]): NewsItem[] {
  return items.flatMap((item) => {
    const keyword = typeof item?.keyword === "string" ? item.keyword.trim() : ""
    if (!keyword) return []
    return [{
      id: keyword,
      title: typeof item.show_name === "string" && item.show_name.trim() ? item.show_name : keyword,
      url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`,
      extra: {
        icon: typeof item.icon === "string" ? item.icon : undefined,
      },
    }]
  })
}

async function fetchLegacyHotSearch(): Promise<NewsItem[]> {
  const url = "https://s.search.bilibili.com/main/hotword?limit=30"
  const res: WapRes = await myFetch(url, { timeout: 2000, retry: 0 })
  if (res?.code !== 0 || !Array.isArray(res.list)) throw new Error("Cannot fetch Bilibili hot words")
  return mapHotSearch(res.list)
}

async function fetchSquareHotSearch(): Promise<NewsItem[]> {
  const url = "https://api.bilibili.com/x/web-interface/wbi/search/square?limit=10&platform=web"
  const res: SquareRes = await myFetch(url, { timeout: 2000, retry: 0 })
  const list = res?.data?.trending?.list
  if (res?.code !== 0 || !Array.isArray(list)) throw new Error("Cannot fetch Bilibili hot search")
  const news = mapHotSearch(list)
  if (!news.length) throw new Error("Cannot fetch Bilibili hot search")
  return news
}

async function fetchAppHotSearch(): Promise<NewsItem[]> {
  // The app publishes its own hot-search ranking on a separate Bilibili host.
  const url = "https://app.bilibili.com/x/v2/search/trending/ranking?limit=30"
  const res: AppHotSearchRes = await myFetch(url, { timeout: 2000, retry: 0 })
  const list = res?.data?.list
  if (res?.code !== 0 || !Array.isArray(list)) throw new Error("Cannot fetch Bilibili app hot search")
  const news = mapHotSearch(list)
  if (!news.length) throw new Error("Cannot fetch Bilibili app hot search")
  return news.map(item => ({
    ...item,
    extra: { ...item.extra, info: "手机端热搜" },
  }))
}

async function fetchPopularFallback(): Promise<NewsItem[]> {
  const url = "https://api.bilibili.com/x/web-interface/popular"
  const res: HotVideoRes = await myFetch(url, { timeout: 4000, retry: 0 })
  if (res?.code !== 0 || !Array.isArray(res?.data?.list)) throw new Error("Cannot fetch Bilibili popular videos")
  const news = res.data.list.flatMap((video): NewsItem[] => {
    const bvid = video?.bvid
    const title = typeof video?.title === "string" ? video.title.trim() : ""
    if (typeof bvid !== "string" || !/^BV[0-9A-Za-z]{10}$/.test(bvid) || !title) return []
    return [{
      id: bvid,
      title,
      url: `https://www.bilibili.com/video/${bvid}`,
      pubDate: typeof video.pubdate === "number" && Number.isFinite(video.pubdate) && video.pubdate > 0 ? video.pubdate * 1000 : undefined,
      extra: {
        info: "热搜暂不可用，显示热门视频",
        hover: typeof video.desc === "string" ? video.desc : undefined,
        icon: typeof video.pic === "string" ? video.pic : undefined,
      },
    }]
  })
  if (!news.length) throw new Error("Cannot fetch Bilibili popular videos")
  return news
}

async function fetchHotSearchWithFallbacks(): Promise<NewsItem[]> {
  const news = await fetchLegacyHotSearch().catch(() => [])
  if (news.length) return news
  const appNews = await fetchAppHotSearch().catch(() => [])
  if (appNews.length) return appNews
  const squareNews = await fetchSquareHotSearch().catch(() => [])
  return squareNews.length ? squareNews : fetchPopularFallback()
}

const hotSearch = defineSource(async () => {
  // The four requests total at most 10 seconds of configured timeouts.
  // Bound the full response as well so a source never holds the page indefinitely.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fetchHotSearchWithFallbacks(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Bilibili source time budget exceeded")), 11500)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
})

const hotVideo = defineSource(async () => {
  const url = "https://api.bilibili.com/x/web-interface/popular"
  const res: HotVideoRes = await myFetch(url)

  return res.data.list.map(video => ({
    id: video.bvid,
    title: video.title,
    url: `https://www.bilibili.com/video/${video.bvid}`,
    pubDate: video.pubdate * 1000,
    extra: {
      info: `${video.owner.name} · ${formatNumber(video.stat.view)}观看 · ${formatNumber(video.stat.like)}点赞`,
      hover: video.desc,
      icon: video.pic,
    },
  }))
})

const ranking = defineSource(async () => {
  const url = "https://api.bilibili.com/x/web-interface/ranking/v2"
  const res: HotVideoRes = await myFetch(url)

  return res.data.list.map(video => ({
    id: video.bvid,
    title: video.title,
    url: `https://www.bilibili.com/video/${video.bvid}`,
    pubDate: video.pubdate * 1000,
    extra: {
      info: `${video.owner.name} · ${formatNumber(video.stat.view)}观看 · ${formatNumber(video.stat.like)}点赞`,
      hover: video.desc,
      icon: video.pic,
    },
  }))
})

function formatNumber(num: number): string {
  if (num >= 10000) {
    return `${Math.floor(num / 10000)}w+`
  }
  return num.toString()
}

export default defineSource({
  "bilibili": hotSearch,
  "bilibili-hot-search": hotSearch,
  "bilibili-hot-video": hotVideo,
  "bilibili-ranking": ranking,
})
