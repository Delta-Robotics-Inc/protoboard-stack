/**
 * The parts views (PB-902, PB-903, PB-904, PB-912): the library browser and
 * page, a part's detail, the project's parts, the libraries manager, the
 * bill of materials and the Cloud panel. Data in (model.ts), actions out;
 * the shells place them (VS Code: native views and editor tabs; the web
 * shell: the `library` and `bom` tabs).
 */
export type * from "./model.js";
export { PartsSurface, type Place } from "./Surface.js";
export { CARD_PAGES } from "./model.js";
export { CARD_HEIGHT, PartCard, UsePill, type PartCardProps } from "./PartCard.js";
export { CardPage, ImageCarousel, OutlineDrawing, type ImageCarouselProps } from "./CardPages.js";
export { LinkPagesToggle, PagerProvider, PagerStore, PagesProvider, PagesSource, useNewPagerStore, usePagerStore, type PagesLoader, type PagesState } from "./carousel.js";
export { PricesPanel, money, usdFirst, usePrices, type PricesState } from "./Prices.js";
export { Windowed } from "./Windowed.js";
export { PAGE_ICON, PAGE_LABEL, availablePages } from "./part-pages.js";
export { LibraryBrowser, Crumbs, SortMenu, type LibraryBrowserProps } from "./LibraryBrowser.js";
export { CategoryList, type CategoryListProps } from "./CategoryList.js";
export { PartStatusDot, PartStatusLegend, PartStatusStyles, type PartStatusDotProps } from "./PartStatus.js";
export { PART_STATUS_COLORS, PART_STATUS_CSS, PART_STATUS_TONE, PART_TRUST_STATES, PART_TRUST_TEXT, nodeMarks, partStatusVar, partTrustTooltip, type PartStatusScheme } from "./part-status.js";
export { rev, revChange } from "./revision.js";
export { ProjectPartsPage, SyncPill, type ProjectPartsPageProps } from "./ProjectPartsPage.js";
export { LibraryPage, type LibraryPageProps } from "./LibraryPage.js";
export { PartDetail, DETAIL_TABS, detailTabs, type PartDetailProps } from "./PartDetail.js";
export { ProjectParts, partGroups, partNote, partSync, tierGroups, type PartGroup, type PartSync } from "./ProjectParts.js";
export { LibrariesManager, AccountCard } from "./LibrariesManager.js";
export { SettingsPage } from "./SettingsPage.js";
export { BomEditor, formatMoney, offersAge } from "./BomEditor.js";
export { CloudPanel } from "./CloudPanel.js";
export { GlbPreview } from "./GlbPreview.js";
export { Avatar, Button, Card, FoldHeading, Pill, RowAction, SearchField, SectionLabel, StatusText, Tag, Thumb, categoryIcon, factIcon, useFolded, type FoldedGroups } from "./ui.js";
export { BomView, LibraryView, PartsDataProvider, usePartsData, useLibrary, type LibraryPageResult, type PartsData } from "./views.js";
