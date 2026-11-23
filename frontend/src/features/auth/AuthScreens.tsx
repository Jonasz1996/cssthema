import { type FormEvent, type ReactNode, useState } from "react";
import { api, fieldErrorsOf, isApiError, send } from "@/api/client";
import { BackgroundCanvas } from "@/components/BackgroundCanvas";
import {
  Button,
  Callout,
  Card,
  CardBody,
  Code,
  Field,
  Input,
  PageHeader,
  Pre,
  TerminalBar,
  Toaster,
  toast,
} from "@/components/ui";
import { copyText } from "@/features/themes/lib/clipboard";
import { useI18n } from "@/lib/i18n";
import { type AuthState, resetCommand, useSetAuthState } from "./queries";

/** Kaart in de stijl van het dashboard, zonder navigatie (voor aanmelden en instellen). */
function AuthFrame({ command, children }: { command: string; children: ReactNode }) {
  return (
    <div className="ui-stage">
      <BackgroundCanvas mode="running" />
      <div className="ui-wrap mx-auto max-w-[520px]">
        <Card>
          <TerminalBar command={command} />
          <CardBody>
            <main id="main" className="min-w-0">
              {children}
            </main>
          </CardBody>
        </Card>
      </div>
      <Toaster />
    </div>
  );
}

function errorText(error: unknown): string | null {
  if (!error) return null;
  if (isApiError(error)) return error.detail ?? error.title;
  return String(error);
}

export function LoginScreen() {
  const { t } = useI18n();
  const setState = useSetAuthState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recover, setRecover] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await send(
        api.POST("/api/v1/auth/login", {
          body: { email, password, code: needCode ? code : null },
        }),
      );
      setState(data);
    } catch (err) {
      if (isApiError(err) && err.code === "mfa_required") {
        setNeedCode(true);
      } else {
        setError(errorText(err));
        if (needCode) setCode("");
      }
    } finally {
      setBusy(false);
    }
  }

  if (recover) {
    return (
      <AuthFrame command="cssthema-account reset">
        <RecoverAccess email={email} onEmail={setEmail} onBack={() => setRecover(false)} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame command="login">
      <PageHeader title={t("auth.loginTitle")} hint={t("auth.loginHint")} />
      <form onSubmit={submit} noValidate>
        <Field label={t("auth.email")}>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label={t("auth.password")}>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {needCode && (
          <Field label={t("auth.code")} hint={t("auth.codeHint")}>
            <Input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
        )}
        {error && (
          <Callout tone="err" role="alert" className="mt-4">
            {error}
          </Callout>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !email || !password}>
            {busy ? t("auth.loggingIn") : t("auth.login")}
          </Button>
          <Button variant="alt" size="sm" onClick={() => setRecover(true)}>
            {t("auth.cannotLogin")}
          </Button>
        </div>
      </form>
    </AuthFrame>
  );
}

/**
 * "Kan niet inloggen": toont alleen het commando voor de beheerder. Er gaat niets naar de
 * server, dus de pagina verraadt niet of een e-mailadres een account heeft.
 */
function RecoverAccess({
  email,
  onEmail,
  onBack,
}: {
  email: string;
  onEmail: (value: string) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const command = resetCommand(email);
  return (
    <>
      <PageHeader title={t("auth.resetTitle")} />
      <Field label={t("auth.email")} hint={t("auth.resetEmailHint")}>
        <Input
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(event) => onEmail(event.target.value)}
        />
      </Field>
      {command ? (
        <div data-testid="reset-command" className="mt-4">
          <p>{t("auth.resetAsk")}</p>
          <Pre className="my-3 select-all">
            <Code>{command}</Code>
          </Pre>
          <Button
            size="sm"
            variant="alt"
            onClick={async () => {
              const ok = await copyText(command);
              if (ok) toast.ok(t("auth.copied"));
              else toast.err(t("auth.copyFailed"));
            }}
          >
            {t("auth.copy")}
          </Button>
          <p className="mt-4">{t("auth.resetAfter")}</p>
        </div>
      ) : (
        <p className="mt-4 text-muted">{t("auth.resetNoEmail")}</p>
      )}
      <div className="mt-5">
        <Button variant="alt" size="sm" onClick={onBack}>
          {t("auth.backToLogin")}
        </Button>
      </div>
    </>
  );
}

/** Eerste aanmelding na `nieuw` of `reset`: eerst een eigen wachtwoord, dan MFA. */
export function SetupScreen({ state }: { state: AuthState }) {
  return (
    <AuthFrame command="account instellen">
      {state.must_change_password ? <ChangePassword /> : <SetupMfa />}
    </AuthFrame>
  );
}

function ChangePassword() {
  const { t } = useI18n();
  const setState = useSetAuthState();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = fieldErrorsOf(error);
  const mismatch = repeat.length > 0 && next !== repeat;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== repeat) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await send(
        api.POST("/api/v1/auth/password", {
          body: { current_password: current, new_password: next },
        }),
      );
      setState(data);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t("auth.setupPasswordTitle")} hint={t("auth.setupPasswordHint")} />
      <form onSubmit={submit} noValidate>
        <Field label={t("auth.currentPassword")} error={fields.current_password}>
          <Input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <Field label={t("auth.newPassword")} error={fields.new_password}>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </Field>
        <Field
          label={t("auth.repeatPassword")}
          error={mismatch ? t("auth.passwordMismatch") : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </Field>
        {error && Object.keys(fields).length === 0 ? (
          <Callout tone="err" role="alert" className="mt-4">
            {errorText(error)}
          </Callout>
        ) : null}
        <div className="mt-5">
          <Button type="submit" disabled={busy || !current || !next || next !== repeat}>
            {t("auth.savePassword")}
          </Button>
        </div>
      </form>
    </>
  );
}

function SetupMfa() {
  const { t } = useI18n();
  const setState = useSetAuthState();
  const [setup, setSetup] = useState<{ secret: string; qr_svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = fieldErrorsOf(error);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await send(api.POST("/api/v1/auth/mfa/start"));
      setSetup(data);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await send(api.POST("/api/v1/auth/mfa/confirm", { body: { code } }));
      setState(data);
    } catch (err) {
      setError(err);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t("auth.setupMfaTitle")} hint={t("auth.setupMfaHint")} />
      {!setup ? (
        <Button onClick={start} disabled={busy}>
          {t("auth.mfaStart")}
        </Button>
      ) : (
        <form onSubmit={confirm} noValidate>
          <div
            className="mx-auto my-3 w-fit rounded-[10px] bg-white p-2 [&_svg]:block [&_svg]:h-auto [&_svg]:w-[220px]"
            // De SVG komt van de eigen api (segno), niet van gebruikersinvoer.
            dangerouslySetInnerHTML={{ __html: setup.qr_svg }}
          />
          <p className="text-muted">{t("auth.mfaManual")}</p>
          <Pre className="my-2 select-all">
            <Code>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</Code>
          </Pre>
          <Field label={t("auth.code")} error={fields.code}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <div className="mt-5">
            <Button type="submit" disabled={busy || code.trim().length < 6}>
              {t("auth.mfaConfirm")}
            </Button>
          </div>
        </form>
      )}
      {error && Object.keys(fields).length === 0 ? (
        <Callout tone="err" role="alert" className="mt-4">
          {errorText(error)}
        </Callout>
      ) : null}
    </>
  );
}
