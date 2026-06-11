import type { Asset } from "@ics/shared";
import { Chart } from "./Chart";
import { LineChart } from "./LineChart";
import { StatGrid } from "./StatGrid";
import { Donut } from "./Donut";
import { Waterfall } from "./Waterfall";
import { Gauge } from "./Gauge";

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
    case "donut":
      return <Donut spec={asset.spec} />;
    case "waterfall":
      return <Waterfall spec={asset.spec} />;
    case "gauge":
      return <Gauge spec={asset.spec} />;
    default:
      return null;
  }
};
