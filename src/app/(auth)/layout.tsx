export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-scopiq-mesh relative flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div className="relative flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2.5 self-center">
          <img src="/icon.svg" alt="Scopiq" className="size-8" />
          <span className="font-heading text-lg font-bold">Scopiq</span>
        </div>
        {children}
      </div>
    </div>
  );
}
