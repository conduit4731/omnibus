// Fork: Batcave-style tab bar for the series and event pages — one full-width bar split evenly, the active
// tab filled with the primary colour.
"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function PageTabs({ defaultValue, tabs }: { defaultValue: string, tabs: { value: string, label: string, content: React.ReactNode }[] }) {
    return (
        <Tabs defaultValue={defaultValue} className="gap-6">
            <TabsList className="grid! w-full h-auto! p-1 rounded-xl bg-muted/60 border border-border" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
                {tabs.map(t => (
                    <TabsTrigger key={t.value} value={t.value} className="h-9 rounded-lg text-sm font-semibold data-[state=active]:bg-primary! data-[state=active]:text-primary-foreground! data-[state=active]:shadow-sm">
                        {t.label}
                    </TabsTrigger>
                ))}
            </TabsList>
            {tabs.map(t => <TabsContent key={t.value} value={t.value} className="space-y-10 min-w-0">{t.content}</TabsContent>)}
        </Tabs>
    );
}
