// Search/filter interaction adapted from shugar's Combobox, retrieved through 21st.dev.
// https://21st.dev/@shugar/components/combobox
import { useEffect, useState } from "react";
import {
  Search,
  RefreshCw,
  Plus,
  ArrowUpRight,
  Brain,
  Eye,
  Wrench,
} from "lucide-react";
import { api } from "../api";
import type { Provider, Model, Catalog } from "../types";
export function ModelLibrary({
  providers,
  onChoose,
  compact = false,
}: {
  providers: Provider[];
  onChoose: (provider: Provider, model: Model) => void;
  compact?: boolean;
}) {
  const catalogProviders = providers.some((p) => p.id === "openrouter")
    ? providers
    : [
        ...providers,
        {
          id: "openrouter",
          name: "OpenRouter catalog",
          kind: "openai_compat" as const,
          base_url: "https://openrouter.ai/api/v1",
          has_key: false,
        },
      ];
  const [compare, setCompare] = useState<Model[]>([]),
    [adding, setAdding] = useState(false);
  const [providerID, setProviderID] = useState(
      providers[0]?.id || "openrouter",
    ),
    [catalog, setCatalog] = useState<Catalog>({ models: [], truncated: false }),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [visible, setVisible] = useState(40),
    [chosen, setChosen] = useState("");
  const provider =
    catalogProviders.find((p) => p.id === providerID) || catalogProviders[0];
  useEffect(() => {
    if (!provider) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setCatalog({ models: [], truncated: false });
    api<Catalog>(
      provider.id === "openrouter" &&
        !providers.some((p) => p.id === "openrouter")
        ? "/catalog/openrouter"
        : `/providers/${encodeURIComponent(provider.id)}/models`,
      { signal: controller.signal },
    )
      .then(setCatalog)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [provider?.id, revision]);
  useEffect(() => setVisible(40), [query, filter, providerID]);
  const matches = catalog.models.filter(
    (m) =>
      (m.name + " " + m.id + " " + (m.description || ""))
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "free" && m.free === true) ||
        m.capabilities.includes(filter)),
  );
  return (
    <section
      className={`model-library ${compact ? "compact" : ""}`}
      aria-label="Model library"
    >
      <header className="library-heading">
        <div>
          <h2>{compact ? "Discover models" : "Model library"}</h2>
          <p>
            {compact
              ? "Pick a model. Give it a seat."
              : "Find the voices for your next conversation."}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh models"
          onClick={() => setRevision((r) => r + 1)}
          disabled={loading || !provider}
        >
          <RefreshCw
            aria-hidden="true"
            size={17}
            className={loading ? "spin" : ""}
          />
        </button>
      </header>
      {!provider ? (
        <div className="library-empty">
          <p>Connect your first provider to browse its models.</p>
          <a className="button secondary" href="/?view=providers">
            Connect a provider <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </div>
      ) : (
        <>
          <label className="catalog-provider">
            Provider
            <select
              aria-label="Model library provider"
              value={provider.id}
              onChange={(e) => {
                setProviderID(e.target.value);
                setChosen("");
                setCompare([]);
              }}
            >
              {catalogProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </label>
          <div className="model-search">
            <Search aria-hidden="true" size={18} />
            <input
              name="model-search"
              type="search"
              aria-label="Search models"
              autoComplete="off"
              placeholder="Search models…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="model-filters" aria-label="Model filters">
            {[
              ["all", "All models"],
              ["free", "Free"],
              ["reasoning", "Reasoning"],
              ["vision", "Vision"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="catalog-count" role="status">
            {loading
              ? "Fetching provider catalog…"
              : `${new Intl.NumberFormat().format(matches.length)} ${matches.length === 1 ? "model" : "models"}${catalog.truncated ? " · limited catalog" : ""}`}
          </p>
          {error ? (
            <div className="catalog-error" role="alert">
              <strong>Couldn’t load this provider’s models.</strong>
              <p>
                {error}. Check your provider settings, refresh, or enter a model
                ID in the participant form.
              </p>
              <a href="/?view=providers">
                Provider settings <ArrowUpRight aria-hidden="true" size={14} />
              </a>
            </div>
          ) : !loading && matches.length === 0 ? (
            <p className="library-empty">
              {catalog.models.length
                ? "No models match. Try another search or filter."
                : "This provider returned no models. You can still enter a model ID manually."}
            </p>
          ) : (
            <ul className="model-results">
              {matches.slice(0, visible).map((m) => (
                <li key={m.id}>
                  <div className="model-item-heading">
                    <span className="model-mark" aria-hidden="true">
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <h3>{m.name}</h3>
                      <code>{m.id}</code>
                    </div>
                    <button
                      type="button"
                      className="model-add"
                      aria-label={`Add ${m.name}`}
                      disabled={adding}
                      onClick={async () => {
                        setAdding(true);
                        try {
                          await onChoose(provider, m);
                          setChosen(m.name);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setAdding(false);
                        }
                      }}
                    >
                      <Plus aria-hidden="true" size={18} />
                    </button>
                  </div>
                  {m.description && (
                    <p className="model-description">{m.description}</p>
                  )}
                  <button
                    className="compare-model"
                    type="button"
                    aria-pressed={compare.some((x) => x.id === m.id)}
                    onClick={() =>
                      setCompare((old) =>
                        old.some((x) => x.id === m.id)
                          ? old.filter((x) => x.id !== m.id)
                          : old.length >= 4
                            ? old
                            : [...old, m],
                      )
                    }
                  >
                    Compare<span className="sr-only"> {m.name}</span>
                  </button>
                  <div className="model-meta">
                    {m.free === true && (
                      <span className="free-label">Free</span>
                    )}
                    {m.free === false && <span>Paid</span>}
                    {m.free === undefined && <span>Pricing unavailable</span>}
                    {m.context_length ? (
                      <span>
                        {new Intl.NumberFormat(undefined, {
                          notation: "compact",
                        }).format(m.context_length)}{" "}
                        context
                      </span>
                    ) : null}
                    {m.capabilities.map((c) => (
                      <span key={c}>
                        {c === "reasoning" ? (
                          <Brain aria-hidden="true" size={12} />
                        ) : c === "vision" ? (
                          <Eye aria-hidden="true" size={12} />
                        ) : (
                          <Wrench aria-hidden="true" size={12} />
                        )}{" "}
                        {c}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {compare.length > 0 && (
            <div className="model-comparison">
              <h3>Compare models</h3>
              <div className="comparison-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col">Pricing</th>
                      <th scope="col">Context</th>
                      <th scope="col">Capabilities</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compare.map((m) => (
                      <tr key={m.id}>
                        <th scope="row">{m.name}</th>
                        <td>
                          {m.free === true
                            ? "Free"
                            : m.free === false
                              ? "Paid"
                              : "Unknown"}
                        </td>
                        <td>
                          {m.context_length
                            ? new Intl.NumberFormat().format(m.context_length)
                            : "Unknown"}
                        </td>
                        <td>{m.capabilities.join(", ") || "Not reported"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => setCompare([])}
              >
                Clear comparison
              </button>
            </div>
          )}
          {matches.length > visible && (
            <button
              type="button"
              className="button secondary show-models"
              onClick={() => setVisible((v) => v + 40)}
            >
              Show more models
            </button>
          )}
          <p role="status" className="model-added">
            {chosen ? `${chosen} added to your conversation.` : ""}
          </p>
          <p className="catalog-note">
            {provider.id === "openrouter" && !provider.has_key
              ? "An OpenRouter API key is required to run these models, including free ones. "
              : ""}
            Listed by {provider.name || provider.id}. Availability and limits
            can change. Capabilities are provider metadata. ThinkPit sends text
            context; model tools aren’t enabled.
          </p>
        </>
      )}
    </section>
  );
}
