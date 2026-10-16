import type {SiteCategory} from "./site-categories";

// Kept apart from the full catalog: the blocklist needs these defaults in every
// content script, and the catalog is too large to bundle there.
export const OFF_BY_DEFAULT_CATEGORIES: SiteCategory[] = [
  {
    id: "video",
    label: "Video & streaming",
    sites: [
      { domain: "youtube.com", label: "YouTube" },
      { domain: "netflix.com", label: "Netflix" },
      { domain: "twitch.tv", label: "Twitch" },
      { domain: "vimeo.com", label: "Vimeo" },
      { domain: "primevideo.com", label: "Prime Video" },
      { domain: "disneyplus.com", label: "Disney+" },
      { domain: "open.spotify.com", label: "Spotify" },
    ],
  },
  {
    id: "messaging",
    label: "Email & messaging",
    sites: [
      { domain: "mail.google.com", label: "Gmail" },
      { domain: "outlook.live.com", label: "Outlook" },
      { domain: "outlook.office.com", label: "Outlook (work)" },
      { domain: "web.whatsapp.com", label: "WhatsApp" },
      { domain: "web.telegram.org", label: "Telegram" },
      { domain: "discord.com", label: "Discord" },
      { domain: "app.slack.com", label: "Slack" },
      { domain: "teams.microsoft.com", label: "Microsoft Teams" },
    ],
  },
  {
    id: "shopping",
    label: "Shopping",
    sites: [
      { domain: "amazon.com", label: "Amazon" },
      { domain: "ebay.com", label: "eBay" },
      { domain: "etsy.com", label: "Etsy" },
      { domain: "aliexpress.com", label: "AliExpress" },
      { domain: "walmart.com", label: "Walmart" },
    ],
  },
  // Domains match their subdomains too, so search engines are listed by their
  // www host: a bare google.com would also switch off Scholar and Docs.
  {
    id: "search",
    label: "Web search",
    sites: [
      { domain: "www.google.com", label: "Google Search" },
      { domain: "www.bing.com", label: "Bing" },
      { domain: "duckduckgo.com", label: "DuckDuckGo" },
    ],
  },
];

export const DEFAULT_DISABLED_SITES: string[] = OFF_BY_DEFAULT_CATEGORIES.flatMap((category) =>
  category.sites.map((site) => site.domain));
