import { Box, Button, Input, Text, Textarea } from "@saleor/macaw-ui";

import { ChannelProgram, Reminder } from "@/modules/app-config/domain/app-config";

export type ReminderFormState = {
  name: string;
  hoursAfterLastActivity: string;
  subject: string;
  bodyHtml: string;
};

export type ProgramFormState = {
  channelSlug: string;
  enabled: boolean;
  perEmailThrottleHours: string;
  reminders: ReminderFormState[];
};

export const programToForm = (p: ChannelProgram): ProgramFormState => ({
  channelSlug: p.channelSlug,
  enabled: p.enabled,
  perEmailThrottleHours: String(p.perEmailThrottleHours),
  reminders: p.reminders.map((r) => ({
    name: r.name,
    hoursAfterLastActivity: String(r.hoursAfterLastActivity),
    subject: r.subject,
    bodyHtml: r.bodyHtml,
  })),
});

export const formToProgram = (p: ProgramFormState): ChannelProgram => ({
  channelSlug: p.channelSlug,
  enabled: p.enabled,
  perEmailThrottleHours: Number(p.perEmailThrottleHours) || 0,
  reminders: p.reminders.map(
    (r): Reminder => ({
      name: r.name,
      hoursAfterLastActivity: Number(r.hoursAfterLastActivity) || 1,
      subject: r.subject,
      bodyHtml: r.bodyHtml,
    }),
  ),
});

export function ProgramEditor({
  program,
  onChange,
  onRemove,
}: {
  program: ProgramFormState;
  onChange: (next: ProgramFormState) => void;
  onRemove: () => void;
}) {
  const updateReminder = (idx: number, patch: Partial<ReminderFormState>) =>
    onChange({
      ...program,
      reminders: program.reminders.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });
  const removeReminder = (idx: number) =>
    onChange({
      ...program,
      reminders: program.reminders.filter((_, i) => i !== idx),
    });
  const addReminder = () =>
    onChange({
      ...program,
      reminders: [
        ...program.reminders,
        {
          name: `Reminder ${program.reminders.length + 1}`,
          hoursAfterLastActivity: "24",
          subject: "Still thinking it over?",
          bodyHtml: "<p>Hi {{customer.firstName}},</p><p>Your cart's waiting: <a href=\"{{cart.recoveryUrl}}\">view it</a>.</p>",
        },
      ],
    });

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={3}
      padding={3}
      borderWidth={1}
      borderStyle="solid"
      borderRadius={3}
    >
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Text size={4}>Channel program</Text>
        <Button variant="tertiary" onClick={onRemove}>
          Remove program
        </Button>
      </Box>
      <Box display="grid" __gridTemplateColumns="2fr 1fr 1fr" gap={3}>
        <Input
          label="Channel slug"
          value={program.channelSlug}
          onChange={(e) => onChange({ ...program, channelSlug: e.target.value })}
        />
        <Input
          label="Per-email throttle (hours)"
          type="number"
          value={program.perEmailThrottleHours}
          onChange={(e) => onChange({ ...program, perEmailThrottleHours: e.target.value })}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={program.enabled}
            onChange={(e) => onChange({ ...program, enabled: e.target.checked })}
          />
          Enabled
        </label>
      </Box>

      {program.reminders.map((r, idx) => (
        <Box
          key={idx}
          display="flex"
          flexDirection="column"
          gap={2}
          padding={2}
          borderWidth={1}
          borderStyle="solid"
          borderRadius={3}
        >
          <Box display="grid" __gridTemplateColumns="2fr 1fr auto" gap={2}>
            <Input
              label="Reminder name"
              value={r.name}
              onChange={(e) => updateReminder(idx, { name: e.target.value })}
            />
            <Input
              label="Hours after last activity"
              type="number"
              value={r.hoursAfterLastActivity}
              onChange={(e) => updateReminder(idx, { hoursAfterLastActivity: e.target.value })}
            />
            <Button variant="tertiary" onClick={() => removeReminder(idx)}>
              ✕
            </Button>
          </Box>
          <Input
            label="Subject"
            value={r.subject}
            onChange={(e) => updateReminder(idx, { subject: e.target.value })}
          />
          <Textarea
            label="Body (HTML, Handlebars merge variables supported)"
            value={r.bodyHtml}
            rows={8}
            onChange={(e) => updateReminder(idx, { bodyHtml: e.target.value })}
          />
        </Box>
      ))}
      <Box>
        <Button variant="secondary" onClick={addReminder}>
          Add reminder
        </Button>
      </Box>
    </Box>
  );
}
