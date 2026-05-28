import { Box, Button, Input, Text, Textarea } from "@saleor/macaw-ui";
import { useEffect, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

import { formToProgram,ProgramEditor, ProgramFormState, programToForm } from "./program-editor";

type SmtpFormState = {
  host: string;
  port: string;
  user: string;
  password: string;
  useTls: boolean;
  fromEmail: string;
  fromName: string;
};

const emptySmtp = (): SmtpFormState => ({
  host: "smtp.ionos.com",
  port: "587",
  user: "",
  password: "",
  useTls: true,
  fromEmail: "",
  fromName: "88Clipon",
});

const defaultReminder = (channelSlug: string): ProgramFormState => ({
  channelSlug,
  enabled: true,
  perEmailThrottleHours: "24",
  reminders: [
    {
      name: "First nudge",
      hoursAfterLastActivity: "1",
      subject: "You left something behind",
      bodyHtml: `<p>Hi {{customer.firstName}},</p>
<p>You left {{cart.itemCount}} item(s) in your cart at {{store.name}}. Pick up where you left off:</p>
<p><a href="{{cart.recoveryUrl}}">Return to your cart</a></p>
<p>Total: {{cart.currency}} {{cart.total}}</p>`,
    },
  ],
});

export const ConfigurationView = () => {
  const utils = trpcClient.useUtils();
  const configQuery = trpcClient.config.get.useQuery();
  const saveMutation = trpcClient.config.save.useMutation({
    onSuccess: () => utils.config.get.invalidate(),
  });
  const testEmail = trpcClient.config.sendTestEmail.useMutation();
  const runOnce = trpcClient.config.runOnce.useMutation();

  const [storeName, setStoreName] = useState("88Clipon");
  const [storefrontUrl, setStorefrontUrl] = useState("");
  const [retentionDays, setRetentionDays] = useState("30");
  const [smtp, setSmtp] = useState<SmtpFormState>(emptySmtp());
  const [programs, setPrograms] = useState<ProgramFormState[]>([
    defaultReminder("default-channel"),
  ]);
  const [testTo, setTestTo] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // Hydrate from the saved config the first time it loads.
  useEffect(() => {
    const cfg = configQuery.data;

    if (!cfg) return;

    setStoreName(cfg.storeName);
    setStorefrontUrl(cfg.storefrontUrl ?? "");
    setRetentionDays(String(cfg.retentionDays));

    if (cfg.smtp) {
      setSmtp({
        host: cfg.smtp.host,
        port: String(cfg.smtp.port),
        user: cfg.smtp.user,
        password: cfg.smtp.password,
        useTls: cfg.smtp.useTls,
        fromEmail: cfg.smtp.fromEmail,
        fromName: cfg.smtp.fromName,
      });
    }

    if (cfg.programs.length > 0) {
      setPrograms(cfg.programs.map(programToForm));
    }
  }, [configQuery.data]);

  const handleSave = async () => {
    setNotice(null);
    try {
      await saveMutation.mutateAsync({
        storeName,
        storefrontUrl: storefrontUrl || undefined,
        retentionDays: Number(retentionDays) || 30,
        smtp: smtp.user
          ? {
              host: smtp.host,
              port: Number(smtp.port) || 587,
              user: smtp.user,
              password: smtp.password,
              useTls: smtp.useTls,
              fromEmail: smtp.fromEmail,
              fromName: smtp.fromName,
            }
          : undefined,
        programs: programs.map(formToProgram),
      });
      setNotice("Saved.");
    } catch (e) {
      setNotice(`Save failed: ${(e as Error).message}`);
    }
  };

  const handleSendTest = async () => {
    setNotice(null);
    try {
      const result = await testEmail.mutateAsync({
        host: smtp.host,
        port: Number(smtp.port) || 587,
        user: smtp.user,
        password: smtp.password,
        useTls: smtp.useTls,
        fromEmail: smtp.fromEmail,
        fromName: smtp.fromName,
        to: testTo,
      });

      setNotice(`Test email sent (messageId: ${result.messageId})`);
    } catch (e) {
      setNotice(`Test failed: ${(e as Error).message}`);
    }
  };

  const handleRunOnce = async () => {
    setNotice(null);
    try {
      const summary = await runOnce.mutateAsync();

      setNotice(`Scheduler ran. Scanned ${summary.scanned}, sent ${summary.sent}.`);
    } catch (e) {
      setNotice(`Run failed: ${(e as Error).message}`);
    }
  };

  return (
    <Box padding={6} display="flex" flexDirection="column" gap={6}>
      <Box>
        <Text size={7}>Abandoned cart recovery</Text>
        <Text color="default2">
          Track checkouts that don&apos;t convert and email customers a configurable sequence of
          reminders. Reminders fire from an in-process scheduler; configure SMTP and at least
          one channel program below.
        </Text>
      </Box>

      <Section title="General">
        <Input label="Store name (used in templates)" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
        <Input
          label="Storefront URL (used to build cart-recovery links)"
          value={storefrontUrl}
          placeholder="https://88clipon.com"
          onChange={(e) => setStorefrontUrl(e.target.value)}
        />
        <Input
          label="Retention (days) — abandoned carts auto-delete after this many days"
          type="number"
          value={retentionDays}
          onChange={(e) => setRetentionDays(e.target.value)}
        />
      </Section>

      <Section title="SMTP">
        <Box display="grid" __gridTemplateColumns="2fr 1fr" gap={3}>
          <Input label="Host" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />
          <Input label="Port" type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} />
        </Box>
        <Input label="Username (email)" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} />
        <Input
          label="Password"
          type="password"
          value={smtp.password}
          placeholder="Leave blank to keep existing"
          onChange={(e) => setSmtp({ ...smtp, password: e.target.value })}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={smtp.useTls} onChange={(e) => setSmtp({ ...smtp, useTls: e.target.checked })} />
          Use TLS (STARTTLS on port 587)
        </label>
        <Box display="grid" __gridTemplateColumns="1fr 1fr" gap={3}>
          <Input label="From name" value={smtp.fromName} onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })} />
          <Input label="From email" value={smtp.fromEmail} onChange={(e) => setSmtp({ ...smtp, fromEmail: e.target.value })} />
        </Box>
        <Box display="flex" gap={2} alignItems="end">
          <Input label="Send test email to" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Button variant="secondary" onClick={handleSendTest} disabled={!testTo || testEmail.isLoading}>
            {testEmail.isLoading ? "Sending…" : "Send test"}
          </Button>
        </Box>
      </Section>

      <Section title="Channel programs">
        <Text color="default2" size={2}>
          One program per channel. Each program is a sequence of reminders. Templates support{" "}
          <code>{"{{customer.firstName}}"}</code>, <code>{"{{cart.recoveryUrl}}"}</code>,{" "}
          <code>{"{{cart.itemCount}}"}</code>, <code>{"{{cart.total}}"}</code>,{" "}
          <code>{"{{cart.currency}}"}</code>, <code>{"{{cart.items}}"}</code>,{" "}
          <code>{"{{store.name}}"}</code>. To include a discount code, just type it as text in the body.
        </Text>
        {programs.map((p, idx) => (
          <ProgramEditor
            key={idx}
            program={p}
            onChange={(next) => setPrograms(programs.map((x, i) => (i === idx ? next : x)))}
            onRemove={() => setPrograms(programs.filter((_, i) => i !== idx))}
          />
        ))}
        <Button variant="secondary" onClick={() => setPrograms([...programs, defaultReminder("default-channel")])}>
          Add channel program
        </Button>
      </Section>

      <Box display="flex" gap={3} alignItems="center">
        <Button onClick={handleSave} disabled={saveMutation.isLoading}>
          {saveMutation.isLoading ? "Saving…" : "Save configuration"}
        </Button>
        <Button variant="secondary" onClick={handleRunOnce} disabled={runOnce.isLoading}>
          {runOnce.isLoading ? "Running…" : "Run scheduler now"}
        </Button>
        {notice && <Text>{notice}</Text>}
      </Box>
    </Box>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box
    display="flex"
    flexDirection="column"
    gap={3}
    padding={4}
    borderWidth={1}
    borderStyle="solid"
    borderRadius={3}
  >
    <Text size={5}>{title}</Text>
    {children}
  </Box>
);

// Silence unused import warning while we ship the textarea via the editor.
void Textarea;
