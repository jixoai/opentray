import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const tabs = [
  {
    name: "Explore",
    value: "explore",
    content: (
      <>
        Discover <span className="text-foreground font-semibold">fresh ideas</span>, trending topics, and hidden gems
        curated just for you. Start exploring and let your curiosity lead the way!
      </>
    ),
  },
  {
    name: "Favorites",
    value: "favorites",
    content: (
      <>
        All your <span className="text-foreground font-semibold">favorites</span> are saved here. Revisit articles,
        collections, and moments you love, any time you want a little inspiration.
      </>
    ),
  },
  {
    name: "Surprise Me",
    value: "surprise",
    content: (
      <>
        <span className="text-foreground font-semibold">Surprise!</span> Here&apos;s something unexpected - a fun fact,
        a quirky tip, or a daily challenge. Come back for a new surprise every day!
      </>
    ),
  },
]

const TabsLiftedDemo = () => {
  return (
    <div>
      <Tabs defaultValue="explore" className="gap-4">
        <TabsList className="justify-start rounded-none border-b bg-transparent p-0">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="data-active:border-b-background! data-active:border-border bg-transparent! shadow-none! data-active:-mb-0.75 data-active:rounded-b-none data-active:border-b-2"
            >
              {tab.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <p className="text-muted-foreground text-sm">{tab.content}</p>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

export default TabsLiftedDemo
