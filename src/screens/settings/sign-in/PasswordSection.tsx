/**
 * Sign-in methods → Password: change it. The hub re-checks the current
 * password itself (`auth.changeOwnPassword`), so a stolen session cannot rotate
 * the credential silently; the form only refuses what would fail anyway.
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from '../../../lib/icons.js'
import { Section } from '../../../components/ui/Section.js'
import { Row } from '../../../components/ui/Row.js'
import { useNotice } from '../../../components/ui/confirm.js'
import { useChangePassword } from '../../../data/use-sign-in-methods.js'
import { MIN_PASSWORD_LENGTH, passwordFormProblem } from '../../../data/sign-in-methods.js'
import { Field, Panel, PanelText } from './form-parts.js'
import { Button } from '../../../components/ui/Button.js'

export function PasswordSection() {
  const { t } = useTranslation()
  const notice = useNotice()
  const change = useChangePassword()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setOpen(false)
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
  }

  const problem = passwordFormProblem({ current, next, confirm })
  const handleSave = (): void => {
    if (problem !== null) {
      setError(t(`v2.signIn.password.problem.${problem}`, { count: MIN_PASSWORD_LENGTH }))
      return
    }
    setError(null)
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          reset()
          notice({ title: t('v2.signIn.password.changed') })
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <Section title={t('v2.signIn.password.title')}>
      {!open ? (
        <Row icon={Lock} label={t('v2.signIn.password.change')} onPress={() => setOpen(true)} last />
      ) : (
        <Panel>
          <Field
            label={t('v2.signIn.password.current')}
            value={current}
            onChangeText={setCurrent}
            secure
            autoComplete="current-password"
            testID="password-current"
          />
          <Field
            label={t('v2.signIn.password.new')}
            value={next}
            onChangeText={setNext}
            secure
            autoComplete="new-password"
            testID="password-new"
          />
          <Field
            label={t('v2.signIn.password.confirm')}
            value={confirm}
            onChangeText={setConfirm}
            secure
            autoComplete="new-password"
            testID="password-confirm"
          />
          {error !== null ? <PanelText tone="danger">{error}</PanelText> : null}
          <Button
            label={change.isPending ? t('v2.signIn.saving') : t('v2.signIn.password.save')}
            onPress={handleSave}
            disabled={change.isPending}
            testID="password-save"
          />
          <Button label={t('v2.settings.cancel')} kind="secondary" onPress={reset} />
        </Panel>
      )}
    </Section>
  )
}
