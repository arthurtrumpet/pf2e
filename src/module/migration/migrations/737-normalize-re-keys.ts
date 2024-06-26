import { ItemSourcePF2e } from "@item/base/data/index.ts";
import * as R from "remeda";
import { Migration731TogglePropertyToRollOption } from "./731-toggle-property-to-roll-option.ts";

/** Ensure RE keys do not begin with PF2E.RuleElement, rerun migration 731 */
export class Migration737NormalizeRuleElementKeys extends Migration731TogglePropertyToRollOption {
    static override version = 0.737;

    override async updateItem(source: ItemSourcePF2e): Promise<void> {
        const rules: unknown[] = source.system.rules;
        for (const rule of [...rules]) {
            if (!R.isPlainObject(rule) || typeof rule.key !== "string") {
                rules.splice(rules.indexOf(rule), 1);
                continue;
            }

            rule.key = rule.key.trim().replace(/^PF2E\.RuleElement\./, "");
        }

        return super.updateItem(source);
    }
}
