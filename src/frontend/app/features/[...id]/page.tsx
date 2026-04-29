import { listFeatures } from "../../lib/api";
import FeatureForm from "../../components/FeatureForm";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ id: string[] }>;
}) {
  const { id } = await params;
  const fullId = id.map((seg) => decodeURIComponent(seg)).join("/");
  const features = await listFeatures();
  const feature = features.find((f) => f.id === fullId);
  if (!feature) notFound();

  return (
    <div className="space-y-4">
      <nav className="text-xs text-navy/60 flex gap-1.5 items-center" aria-label="breadcrumb">
        <Link href="/" className="hover:text-accent">전체 기능</Link>
        <span>/</span>
        <span className="font-mono">{feature.domainKey}</span>
        <span>/</span>
        <span className="text-navy font-medium">{feature.title}</span>
      </nav>

      <header className="panel">
        <div className="panel-header">
          {feature.title}
          <span className="ml-auto pill">{feature.domainKey}</span>
        </div>
        <div className="px-4 py-4 text-sm text-navy/85">
          <p className="m-0 leading-relaxed">{feature.summary}</p>
        </div>
      </header>

      <FeatureForm feature={feature} />
    </div>
  );
}
