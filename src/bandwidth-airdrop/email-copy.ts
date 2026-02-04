import type { MailCustomizationOptions } from "../MailProcessor.js";

type CopyTotals = {
  totalNodes: number;
  totalKeys: number;
};

export function buildBandwidthAirdropEmailCopy(
  totals: CopyTotals
): MailCustomizationOptions {
  const { totalNodes, totalKeys } = totals;
  const summaryText = `Our records show you purchased ${totalNodes} node(s), so you're receiving ${totalKeys} complimentary Bandwidth Miner key(s) as part of our Bandwidth Miner Airdrop (1 Bandwidth Miner key per 1 node purchased).`;
  const detailText =
    "Each key below is linked to a specific node order. The Order # and Placed date shown under each key correspond to the node purchase tied to that Bandwidth Miner key.";
  const introText = `${summaryText} ${detailText}`;

  const introHtml = [
    `<p style="margin:0 0 16px 0;font-size:16px;line-height:24px;">${summaryText}</p>`,
    `<p style="margin:0 0 16px 0;font-size:16px;line-height:24px;">${detailText}</p>`,
  ].join("");

  return {
    subject: "Your Complimentary Bandwidth Miner Airdrop Keys",
    heading: "Your Complimentary Bandwidth Miner Keys",
    introHtml,
    introText,
  };
}
