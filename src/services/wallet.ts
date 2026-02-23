import { Wallet } from "ethers";

let _wallet: Wallet | null = null;

export function getWallet(): Wallet | null {
  if (_wallet) return _wallet;
  const pk = process.env.PRIVATE_KEY;
  if (!pk) return null;
  _wallet = new Wallet(pk.startsWith("0x") ? pk : "0x" + pk);
  return _wallet;
}

export function getWalletAddress(): string | null {
  return getWallet()?.address ?? null;
}

export function hasWallet(): boolean {
  return !!process.env.PRIVATE_KEY;
}
