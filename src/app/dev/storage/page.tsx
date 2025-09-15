import { notFound } from "next/navigation";
import DevStorageUI from "./ui";

export const dynamic = "force-dynamic";

export default function DevStoragePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <DevStorageUI />;
}

