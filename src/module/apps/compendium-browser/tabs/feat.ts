import { sluggify } from "@util";
import * as R from "remeda";
import { CompendiumBrowser } from "../browser.ts";
import { ContentTabName } from "../data.ts";
import { CompendiumBrowserTab } from "./base.svelte.ts";
import { CompendiumBrowserIndexData, FeatFilters, TraitData } from "./data.ts";

export class CompendiumBrowserFeatTab extends CompendiumBrowserTab {
    tabName: ContentTabName = "feat";
    tabLabel = "PF2E.CompendiumBrowser.TabFeat";
    declare filterData: FeatFilters;

    /* MiniSearch */
    override searchFields = ["name", "originalName"];
    override storeFields = ["type", "name", "img", "uuid", "level", "category", "skills", "traits", "rarity", "source"];

    #creatureTraits = CONFIG.PF2E.creatureTraits;

    constructor(browser: CompendiumBrowser) {
        super(browser);

        // Set the filterData object of this tab
        this.filterData = this.prepareFilterData();
    }

    protected override async loadData(): Promise<void> {
        console.debug("PF2e System | Compendium Browser | Started loading feats");

        const feats: CompendiumBrowserIndexData[] = [];
        const publications = new Set<string>();
        const indexFields = [
            "img",
            "system.actionType.value",
            "system.actions.value",
            "system.category",
            "system.level.value",
            "system.prerequisites.value",
            "system.traits",
            "system.publication",
            "system.source",
        ];

        for await (const { pack, index } of this.browser.packLoader.loadPacks(
            "Item",
            this.browser.loadedPacks("feat"),
            indexFields,
        )) {
            console.debug(`PF2e System | Compendium Browser | ${pack.metadata.label} - ${index.size} entries found`);
            for (const featData of index) {
                if (featData.type === "feat") {
                    featData.filters = {};
                    // Check separately for one of "system.category or "system.featType.value" to provide backward
                    // compatible support for unmigrated feats in non-system compendiums.
                    const categoryPaths = ["system.category", "system.featType.value"];
                    const nonCategoryPaths = indexFields.filter((f) => !categoryPaths.includes(f));
                    const categoryPathFound = categoryPaths.some((p) => fu.hasProperty(featData, p));

                    if (!this.hasAllIndexFields(featData, nonCategoryPaths) || !categoryPathFound) {
                        console.warn(
                            `Feat "${featData.name}" does not have all required data fields.`,
                            `Consider unselecting pack "${pack.metadata.label}" in the compendium browser settings.`,
                        );
                        continue;
                    }

                    // Accommodate deprecated featType objects
                    const featType: unknown = featData.system.featType;
                    if (R.isPlainObject(featType) && "value" in featType && typeof featType.value === "string") {
                        featData.system.category = featType.value;
                        delete featData.system.featType;
                    }

                    // Prerequisites are strings that could contain translated skill names
                    const prereqs: { value: string }[] = featData.system.prerequisites.value;
                    const prerequisitesArr = prereqs.map((prerequisite) =>
                        prerequisite?.value ? prerequisite.value.toLowerCase() : "",
                    );
                    const skills: Set<string> = new Set();
                    for (const prereq of prerequisitesArr) {
                        for (const [key, value] of Object.entries(CONFIG.PF2E.skills)) {
                            // Check the string for the english translation key or a translated skill name
                            const translated = game.i18n.localize(value.label).toLocaleLowerCase(game.i18n.lang);
                            if (prereq.includes(key) || prereq.includes(translated)) {
                                // Alawys record the translation key to enable filtering
                                skills.add(key);
                            }
                        }
                    }

                    // Prepare source
                    const pubSource = featData.system.publication?.title ?? featData.system.source?.value ?? "";
                    const sourceSlug = sluggify(pubSource);
                    if (pubSource) publications.add(pubSource);

                    // Only store essential data
                    feats.push({
                        type: featData.type,
                        name: featData.name,
                        originalName: featData.originalName, // Added by Babele
                        img: featData.img,
                        uuid: featData.uuid,
                        level: featData.system.level.value,
                        category: featData.system.category,
                        skills: [...skills],
                        traits: featData.system.traits.value.map((t: string) => t.replace(/^hb_/, "")),
                        rarity: featData.system.traits.rarity,
                        source: sourceSlug,
                    });
                }
            }
        }

        // Set indexData
        this.indexData = feats;

        // Filters
        this.filterData.checkboxes.category.options = this.generateCheckboxOptions(CONFIG.PF2E.featCategories);
        this.filterData.checkboxes.skills.options = this.generateCheckboxOptions(CONFIG.PF2E.skills);
        this.filterData.checkboxes.rarity.options = this.generateCheckboxOptions(CONFIG.PF2E.rarityTraits);
        this.filterData.source.options = this.generateSourceCheckboxOptions(publications);
        this.filterData.traits.options = this.generateMultiselectOptions(CONFIG.PF2E.featTraits);

        console.debug("PF2e System | Compendium Browser | Finished loading feats");
    }

    protected override filterTraits(
        traits: string[],
        selected: TraitData["selected"],
        condition: TraitData["conjunction"],
    ): boolean {
        // Pre-filter the selected traits if the current ancestry item has no ancestry traits
        if (
            this.filterData.checkboxes.category.selected.includes("ancestry") &&
            !traits.some((t) => t in this.#creatureTraits)
        ) {
            const withoutAncestryTraits = selected.filter((t) => !(t.value in this.#creatureTraits));
            return super.filterTraits(traits, withoutAncestryTraits, condition);
        }
        return super.filterTraits(traits, selected, condition);
    }

    protected override filterIndexData(entry: CompendiumBrowserIndexData): boolean {
        const { checkboxes, source, traits, level } = this.filterData;

        // Level
        if (!(entry.level >= level.from && entry.level <= level.to)) return false;
        // Feat types
        if (checkboxes.category.selected.length) {
            if (!checkboxes.category.selected.includes(entry.category)) return false;
        }
        // Skills
        if (checkboxes.skills.selected.length) {
            if (!this.arrayIncludes(checkboxes.skills.selected, entry.skills)) return false;
        }
        // Traits
        if (!this.filterTraits(entry.traits, traits.selected, traits.conjunction)) return false;
        // Source
        if (source.selected.length) {
            if (!source.selected.includes(entry.source)) return false;
        }
        // Rarity
        if (checkboxes.rarity.selected.length) {
            if (!checkboxes.rarity.selected.includes(entry.rarity)) return false;
        }
        return true;
    }

    protected override prepareFilterData(): FeatFilters {
        return {
            checkboxes: {
                category: {
                    isExpanded: false,
                    label: "PF2E.CompendiumBrowser.Filter.Categories",
                    options: {},
                    selected: [],
                },
                skills: {
                    isExpanded: false,
                    label: "PF2E.SkillsLabel",
                    options: {},
                    selected: [],
                },
                rarity: {
                    isExpanded: false,
                    label: "PF2E.CompendiumBrowser.Filter.Rarities",
                    options: {},
                    selected: [],
                },
            },
            source: {
                isExpanded: false,
                label: "PF2E.CompendiumBrowser.Filter.Source",
                options: {},
                selected: [],
            },
            traits: {
                conjunction: "and",
                options: [],
                selected: [],
            },
            order: {
                by: "level",
                direction: "asc",
                options: {
                    name: { label: "Name", type: "alpha" },
                    level: { label: "PF2E.LevelLabel", type: "numeric" },
                },
                type: "numeric",
            },
            level: {
                changed: false,
                isExpanded: false,
                min: 0,
                max: 20,
                from: 0,
                to: 20,
            },
            search: {
                text: "",
            },
        };
    }
}
