import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getActiveListings,
  getUserListings,
  getMarketStats,
  getMarketplaceConfig,
  buildListBotArgs,
} from "@/lib/contracts";
import { runTxWithToasts } from "@/lib/transaction";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { BotTier, MarketplaceListing } from "@/types";
import type { Tier, MarketplaceListing } from "@/types";
import { TIER_ORDER } from "@/types";
import { pollWhenVisible } from "@/lib/polling";
import { STALE_TIME, GC_TIME, qk } from "@/lib/queryKeys";
import { trackStatus, newTxId } from "@/components/ui/TxStatus";
import type { DashboardData } from "./useAccrual";
import { toastContractError } from "@/lib/errors";
import { CONTRACT_ADDRESSES } from "@/lib/constants";
import { addressToScVal, u64ToScVal } from "@/lib/stellar";
import { errorAnalyticsProps, useAnalytics } from "@/lib/analytics";
export { useProfiles } from "./useProfiles";

export function useBuyBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);
  const { track } = useAnalytics(publicKey);

  return useMutation({
    mutationFn: async (listingId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("buy_bot");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "buy_bot",
        args: [addressToScVal(publicKey), u64ToScVal(listingId)],
        sourceAddress: publicKey,
        id: "buy_bot",
        label: "purchase",
        successMessage: "Bot purchased successfully!",
      });
      trackStatus(txId, "Purchase", status);
      return status;
    },
    onMutate: async (listingId: bigint) => {
      track("marketplace_buy_started");
      // Optimistic update (#462): drop the bought listing immediately.
      await queryClient.cancelQueries({ queryKey: qk.listings() });
      await queryClient.cancelQueries({ queryKey: qk.myListings(publicKey) });
      const previousListings = queryClient.getQueryData(qk.listings());
      const previousMyListings = queryClient.getQueryData(qk.myListings(publicKey));
      const without = (old: MarketplaceListing[] | undefined) =>
        old ? old.filter((l) => l.id !== listingId) : old;
      queryClient.setQueryData(qk.listings(), without);
      queryClient.setQueryData(qk.myListings(publicKey), without);
      return { previousListings, previousMyListings };
    },
    onSuccess: () => {
      track("marketplace_buy_success");
    },
    onError: (
      error: Error,
      _variables: bigint,
      context: { previousListings: unknown; previousMyListings: unknown } | undefined
    ) => {
      track("marketplace_buy_failed", errorAnalyticsProps(error));
      if (context) {
        queryClient.setQueryData(qk.listings(), context.previousListings);
        queryClient.setQueryData(qk.myListings(publicKey), context.previousMyListings);
      }
      toastContractError(error, "marketplace");
      console.error("Bot purchase failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
    },
  });
}

export function useMintTierBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    // mint_tier(owner: Address, tier: Tier) — on-chain Tier is Basic|Advanced|Premium
    // encoded as u32 (0=Basic, 1=Bronze, 2=Silver, 3=Gold, 4=Diamond).
    mutationFn: async ({ tier }: { tier: Tier }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const tierIndex = TIER_ORDER.indexOf(tier);
      if (tierIndex === -1) throw new Error(`Unknown tier: ${tier}`);

      return runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.botNft,
        method: "mint_tier",
        args: [
          nativeToScVal(publicKey, { type: "address" }),
          xdr.ScVal.scvU32(tierIndex),
        ],
        sourceAddress: publicKey,
        id: "mint_tier",
        label: "mint",
        successMessage: "Tier bot minted successfully!",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
    },
    onError: (error: Error) => {
      toastContractError(error, "botNft");
      console.error("Bot mint failed:", error);
    },
  });
}

export function useListings() {
  return useQuery({
    queryKey: qk.listings(),
    queryFn: () => getActiveListings(),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

/** Per-tier sales statistics: volume, sale count, last sale price and floor (#432). */
export function useMarketStats() {
  return useQuery({
    queryKey: qk.marketStats(),
    queryFn: () => getMarketStats(),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

/**
 * On-chain marketplace fee configuration. Fetched once per session
 * (`STALE_TIME.STATIC`): it only changes when the admin calls `set_fee_bps`,
 * and every fee preview must read it instead of a hardcoded 2.5%.
 */
export function useMarketplaceConfig() {
  return useQuery({
    queryKey: qk.marketplaceConfig(),
    queryFn: () => getMarketplaceConfig(),
    staleTime: STALE_TIME.STATIC,
    gcTime: GC_TIME.LONG,
  });
}

export function useMyListings() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery({
    queryKey: qk.myListings(publicKey),
    queryFn: () => (publicKey ? getUserListings(publicKey) : Promise.resolve([])),
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

export function useListBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async ({ botId, price }: { botId: bigint; price: bigint }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("list_bot");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "list_bot",
        // list_bot(seller, bot_id, price, currency): the connected wallet is
        // the seller whose auth the contract requires; currency is the
        // configured payment token.
        args: buildListBotArgs(publicKey, botId, price),
        sourceAddress: publicKey,
        id: "list_bot",
        label: "listing",
        successMessage: "Bot listed successfully!",
      });
      trackStatus(txId, "Listing", status);
      return status;
    },
    onMutate: async ({ botId }: { botId: bigint; price: bigint }) => {
      // Optimistic update (#462): remove the bot from the owned list.
      await queryClient.cancelQueries({ queryKey: qk.bots(publicKey) });
      await queryClient.cancelQueries({ queryKey: qk.dashboard(publicKey) });
      const previousBots = queryClient.getQueryData(qk.bots(publicKey));
      const previousDashboard = queryClient.getQueryData(qk.dashboard(publicKey));
      queryClient.setQueryData(qk.bots(publicKey), (old: bigint[] | undefined) =>
        old ? old.filter((id) => id !== botId) : old
      );
      queryClient.setQueryData(
        qk.dashboard(publicKey),
        (old: DashboardData | undefined) =>
          old ? { ...old, bots: old.bots.filter((id) => id !== botId) } : old
      );
      return { previousBots, previousDashboard };
    },
    onError: (
      error: Error,
      _variables: { botId: bigint; price: bigint },
      context: { previousBots: unknown; previousDashboard: unknown } | undefined
    ) => {
      if (context) {
        queryClient.setQueryData(qk.bots(publicKey), context.previousBots);
        queryClient.setQueryData(qk.dashboard(publicKey), context.previousDashboard);
      }
      toastContractError(error, "marketplace");
      console.error("Bot listing failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.myListings(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
    },
  });
}

export function useCancelListing() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async (listingId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("cancel_listing");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "cancel_listing",
        args: [addressToScVal(publicKey), u64ToScVal(listingId)],
        sourceAddress: publicKey,
        id: "cancel_listing",
        label: "cancellation",
        successMessage: "Listing cancelled successfully!",
      });
      trackStatus(txId, "Cancellation", status);
      return status;
    },
    onMutate: async (listingId: bigint) => {
      // Optimistic update (#462): drop the cancelled listing immediately.
      await queryClient.cancelQueries({ queryKey: qk.listings() });
      await queryClient.cancelQueries({ queryKey: qk.myListings(publicKey) });
      const previousListings = queryClient.getQueryData(qk.listings());
      const previousMyListings = queryClient.getQueryData(qk.myListings(publicKey));
      const without = (old: MarketplaceListing[] | undefined) =>
        old ? old.filter((l) => l.id !== listingId) : old;
      queryClient.setQueryData(qk.listings(), without);
      queryClient.setQueryData(qk.myListings(publicKey), without);
      return { previousListings, previousMyListings };
    },
    onError: (
      error: Error,
      _variables: bigint,
      context: { previousListings: unknown; previousMyListings: unknown } | undefined
    ) => {
      if (context) {
        queryClient.setQueryData(qk.listings(), context.previousListings);
        queryClient.setQueryData(qk.myListings(publicKey), context.previousMyListings);
      }
      toastContractError(error, "marketplace");
      console.error("Listing cancellation failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.myListings(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
    },
  });
}
