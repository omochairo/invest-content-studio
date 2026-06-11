import type { Asset } from "@ics/shared";
import { Chart } from "./Chart";
import { LineChart } from "./LineChart";
import { StatGrid } from "./StatGrid";

/** Resolve any data-driven asset to its visual component by discriminant.
 *  Shared by every composition so a new AssetSpec kind is wired once. */
export const Visual = ({ asset }: { asset: Asset }) => {
  switch (asset.spec.kind) {
    case "bar":
      return <Chart spec={asset.spec} />;
    case "line":
      return <LineChart spec={asset.spec} />;
    case "stats":
      return <StatGrid spec={asset.spec} />;
    default:
      return null;
  }
};
