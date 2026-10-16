import { getCustomSites, getDisabledSites, normaliseSiteInput, saveCustomSites, saveDisabledSites } from "./domains";
import { SITE_CATEGORIES, siteDomains, type CatalogSite, type SiteCategory } from "./site-categories";

const CUSTOM_CATEGORY_ID = "custom";

/** Category checkboxes, each opening to a site-by-site list, saved as the user toggles them. */
export function mountSiteCategoryPicker(container: HTMLElement, onChange?: (message: string) => void): void {
  let disabledSites = new Set<string>();
  let customSites: string[] = [];

  const addForm = document.createElement("form");
  addForm.className = "site-add";
  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.placeholder = "Add a site, e.g. journals.example.org";
  addInput.autocomplete = "off";
  addInput.spellcheck = false;
  addInput.setAttribute("aria-label", "Site to add");
  const addButton = document.createElement("button");
  addButton.type = "submit";
  addButton.textContent = "Add site";
  const addError = document.createElement("p");
  addError.className = "site-add-error";
  addError.setAttribute("role", "alert");
  addError.hidden = true;
  addForm.append(addInput, addButton);

  const list = document.createElement("div");
  container.replaceChildren(addForm, addError, list);

  const showAddError = (message: string): void => {
    addError.textContent = message;
    addError.hidden = false;
  };

  const categories = (): SiteCategory[] => customSites.length === 0 ? SITE_CATEGORIES : [
    { id: CUSTOM_CATEGORY_ID, label: "Your sites", sites: customSites.map((domain) => ({ domain })) },
    ...SITE_CATEGORIES,
  ];

  const setSitesEnabled = async (domains: string[], enabled: boolean): Promise<void> => {
    for (const domain of domains) {
      if (enabled) disabledSites.delete(domain);
      else disabledSites.add(domain);
    }
    await saveDisabledSites([...disabledSites].sort());
    render();
  };

  const removeCustomSite = async (domain: string): Promise<void> => {
    customSites = customSites.filter((d) => d !== domain);
    await saveCustomSites(customSites);
    if (disabledSites.delete(domain)) await saveDisabledSites([...disabledSites].sort());
    render();
    onChange?.(`Removed ${domain}.`);
  };

  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    addError.hidden = true;
    const domain = normaliseSiteInput(addInput.value);
    if (!domain) {
      showAddError("Enter a domain such as journals.example.org.");
      return;
    }
    const listedIn = categories().find((category) => category.sites.some((site) => siteDomains(site).includes(domain)));
    if (listedIn) {
      showAddError(`${domain} is already listed under ${listedIn.label}.`);
      return;
    }
    customSites = [...customSites, domain].sort();
    await saveCustomSites(customSites);
    if (disabledSites.delete(domain)) await saveDisabledSites([...disabledSites].sort());
    addInput.value = "";
    const open = list.querySelector<HTMLDetailsElement>(`details[data-category="${CUSTOM_CATEGORY_ID}"]`);
    render();
    if (!open) list.querySelector<HTMLDetailsElement>(`details[data-category="${CUSTOM_CATEGORY_ID}"]`)!.open = true;
    onChange?.(`ORE will run on ${domain}.`);
  });

  const render = (): void => {
    const open = new Set(
      [...list.querySelectorAll<HTMLDetailsElement>("details[open]")].map((d) => d.dataset.category)
    );
    list.replaceChildren();

    const isOn = (site: CatalogSite): boolean => siteDomains(site).every((d) => !disabledSites.has(d));

    for (const category of categories()) {
      const domains = category.sites.flatMap(siteDomains);
      const enabledCount = category.sites.filter(isOn).length;
      const anyOn = domains.some((d) => !disabledSites.has(d));

      const details = document.createElement("details");
      details.className = "site-category";
      details.dataset.category = category.id;
      details.open = open.has(category.id);

      const summary = document.createElement("summary");
      const all = document.createElement("input");
      all.type = "checkbox";
      all.checked = enabledCount === category.sites.length;
      all.indeterminate = anyOn && !all.checked;
      all.setAttribute("aria-label", `Run ORE on ${category.label} sites`);
      all.addEventListener("click", (e) => e.stopPropagation());
      all.addEventListener("change", () => {
        void setSitesEnabled(domains, all.checked).then(() =>
          onChange?.(`ORE ${all.checked ? "turned on" : "turned off"} for ${category.label.toLowerCase()}.`)
        );
      });

      const name = document.createElement("span");
      name.textContent = category.label;
      const countEl = document.createElement("span");
      countEl.className = "site-category-count";
      countEl.textContent = `${enabledCount} of ${category.sites.length}`;
      summary.append(all, name, countEl);
      details.appendChild(summary);

      const sites = document.createElement("div");
      sites.className = "site-list";
      for (const site of category.sites) {
        const option = document.createElement("label");
        option.className = "site-option";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = isOn(site);
        box.addEventListener("change", () => {
          void setSitesEnabled(siteDomains(site), box.checked).then(() =>
            onChange?.(`ORE ${box.checked ? "turned on" : "turned off"} on ${site.domain}.`)
          );
        });
        const label = document.createElement("span");
        label.textContent = site.label ?? site.domain;
        option.append(box, label);
        if (site.label) {
          const host = document.createElement("small");
          host.textContent = site.aliases?.length ? `${site.domain} + ${site.aliases.length} more` : site.domain;
          if (site.aliases?.length) host.title = siteDomains(site).join(", ");
          option.append(host);
        }
        if (category.id === CUSTOM_CATEGORY_ID) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "site-remove";
          remove.textContent = "×";
          remove.setAttribute("aria-label", `Remove ${site.domain}`);
          remove.addEventListener("click", (e) => {
            e.preventDefault();
            void removeCustomSite(site.domain);
          });
          option.append(remove);
        }
        sites.appendChild(option);
      }
      details.appendChild(sites);
      list.appendChild(details);
    }
  };

  void Promise.all([getDisabledSites(), getCustomSites()]).then(([disabled, custom]) => {
    disabledSites = new Set(disabled);
    customSites = custom;
    render();
  });
}
