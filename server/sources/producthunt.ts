import process from "node:process"
import type { NewsItem } from "@shared/types"

async function feed(): Promise<NewsItem[]> {
  const data = await rss2json("https://www.producthunt.com/feed", { timeout: 8000, retry: 0 })
  const news = (data?.items ?? []).filter(item => (
    typeof item.title === "string" && item.title.trim()
    && typeof item.link === "string" && /^https?:\/\//.test(item.link)
  )).map(item => ({
    id: item.link,
    title: item.title,
    url: item.link,
    pubDate: item.created,
  }))
  if (!news.length) throw new Error("Cannot fetch Product Hunt RSS data")
  return news
}

export default defineSource(async () => {
  const apiToken = process.env.PRODUCTHUNT_API_TOKEN
  const token = `Bearer ${apiToken}`
  if (!apiToken) {
    return feed()
  }
  const query = `
    query {
      posts(first: 30, order: VOTES) {
        edges {
          node {
            id
            name
            tagline
            votesCount
            url
            slug
          }
        }
      }
    }
  `

  try {
    const response: any = await myFetch("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: {
        "Authorization": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ query }),
      timeout: 4000,
      retry: 0,
    })

    const news: NewsItem[] = []
    const posts = response?.data?.posts?.edges
    if (!Array.isArray(posts)) return feed()

    for (const edge of posts) {
      const post = edge?.node
      if (post?.id && post.name) {
        news.push({
          id: post.id,
          title: post.name,
          url: post.url || `https://www.producthunt.com/posts/${post.slug}`,
          extra: {
            info: ` △︎ ${post.votesCount || 0}`,
            hover: post.tagline,
          },
        })
      }
    }

    return news.length ? news : feed()
  } catch {
    return feed()
  }
})
