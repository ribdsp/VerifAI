/** A term and its value; the value is set as data unless `isData` is false. */
export type DefinitionRow = readonly [term: string, value: string, isData?: boolean]

/** Terms beside their values, the values free to wrap anywhere so a narrow screen holds them. */
export function DefinitionList({ rows }: { readonly rows: readonly DefinitionRow[] }) {
  return (
    <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      {rows.map(([term, value, isData = true]) => (
        <div key={term} className="contents">
          <dt className="eyebrow pt-0.5">{term}</dt>
          <dd className={isData ? 'font-mono wrap-anywhere' : ''}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
