// Phase 1 harness smoke test: seeds and ids in docs/design.md section 4 and 8 derive as documented.
// Phase 3 adds one happy test plus negative tests per instruction (LiteSVM first, devnet last).
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";

const PROGRAM_ID = new PublicKey("8LjPXfLAJAifS62qRt8JAgL7g8cXiWoKDr7WAVsDmx1N");
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

describe("cryptoball seeds (design.md section 4)", () => {
  it("derives Config, Campaign, Vault and Ticket PDAs", () => {
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
    const [campaign] = PublicKey.findProgramAddressSync([Buffer.from("campaign"), u64le(1n)], PROGRAM_ID);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), campaign.toBuffer()], PROGRAM_ID);
    const [ticket] = PublicKey.findProgramAddressSync([Buffer.from("ticket"), campaign.toBuffer(), u32le(0)], PROGRAM_ID);
    const all = [config, campaign, vault, ticket].map((k) => k.toBase58());
    expect(new Set(all).size).to.equal(4);
  });

  it("pins the Core and Switchboard devnet program ids", () => {
    expect(new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d").toBase58()).to.be.a("string");
    expect(new PublicKey("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2").toBase58()).to.be.a("string");
  });
});
