import type { RenderElement } from 'claude-code'

import type { PanelView } from '../types'
import { GRILL_STEP, MOCKUP_ADJUST, MOCKUP_STEP, RELEASE_STEP, hiddenChoices } from './grill'
import type { PaneActions, PaneElements } from './pane'

/** The owner buttons of the current flow step the panel leaves out (see hiddenChoices). */
export const hiddenFlowChoices = (els: PaneElements, view: PanelView): string[] =>
  view.flow === undefined ? [] : hiddenChoices(view.flow, view.prep, els.Input !== undefined)

/**
 * What the owner reads under a pre-execution step in "Precisa de você": the grill's rounds and open
 * questions, the mockup with a field to ask for an adjustment, or where to approve the plan.
 */
export const prepDetails = (
  { Box, Text, Link, Button, Input }: PaneElements,
  view: PanelView,
  actions: Pick<PaneActions, 'noteFlow' | 'drafts' | 'draftAnswer' | 'answerGrill'>,
): RenderElement[] => {
  const flow = view.flow
  const prep = view.prep
  if (flow === undefined || flow.status !== 'running' || flow.current === undefined) return []
  const step = flow.current.id
  const lines: RenderElement[] = []
  if (step === GRILL_STEP) {
    const rounds = prep?.rounds ?? 0
    const criteria = prep?.criteria.length ?? 0
    lines.push(
      <Text dimColor wrap="wrap">
        {rounds === 0
          ? 'Nenhuma rodada de perguntas registrada ainda.'
          : `${rounds} ${rounds === 1 ? 'rodada' : 'rodadas'} · ${criteria} ${criteria === 1 ? 'critério de aceite' : 'critérios de aceite'}`}
      </Text>,
    )
    const open = prep?.openItems ?? []
    if (open.length > 0) {
      lines.push(<Text bold>Perguntas em aberto</Text>)
      if (Input === undefined) {
        lines.push(
          ...open.map(q => <Text wrap="wrap">{`${q.n}. ${q.question}`}</Text>),
          <Text dimColor wrap="wrap">Responda no chat.</Text>,
        )
      } else {
        // only the owner's typing fills these fields: the drafts are written by onInput alone
        const draftOf = (question: string) => actions.drafts[question] ?? ''
        lines.push(
          ...open.map(q => (
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} minWidth={0}>
              <Box flexShrink={1} minWidth={0}>
                <Text wrap="wrap">
                  <Text dimColor>{`${q.n}. `}</Text>
                  {q.question}
                </Text>
              </Box>
              <Input
                key={`grill-answer:${q.n}`}
                placeholder="sua resposta"
                submitLabel="responder"
                {...(draftOf(q.question) === '' ? {} : { value: draftOf(q.question) })}
                onInput={actions.draftAnswer(q.question)}
                onSubmit={value => actions.answerGrill(flow.change, [{ ...q, answer: value }])()}
              />
              <Box flexDirection="row" flexShrink={0}>
                <Button
                  key={`grill-send:${q.n}`}
                  variant="secondary"
                  onPress={actions.answerGrill(flow.change, [{ ...q, answer: draftOf(q.question) }])}
                >
                  Responder
                </Button>
              </Box>
            </Box>
          )),
        )
        const filled = open.filter(q => draftOf(q.question).trim() !== '')
        if (filled.length > 1) {
          lines.push(
            <Box flexDirection="row" flexShrink={0}>
              <Button
                key="grill-send-all"
                variant="primary"
                onPress={actions.answerGrill(flow.change, filled.map(q => ({ ...q, answer: draftOf(q.question) })))}
              >
                {`Enviar todas (${filled.length})`}
              </Button>
            </Box>,
          )
        }
      }
    }
  } else if (step === MOCKUP_STEP) {
    if (prep?.mockup === undefined) {
      lines.push(<Text dimColor wrap="wrap">Aguardando a coordenação anexar o mockup.</Text>)
    } else if (prep.mockupIsUrl === true) {
      lines.push(
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>Mockup:</Text>
          <Link href={prep.mockup}>Abrir mockup</Link>
        </Box>,
      )
    } else {
      lines.push(<Text wrap="wrap">{`Mockup: ${prep.mockup}`}</Text>)
    }
    if (prep?.lastAdjustment !== undefined && prep.lastAdjustment !== '') {
      lines.push(<Text dimColor wrap="wrap">{`Último ajuste pedido: ${prep.lastAdjustment}`}</Text>)
    }
    if (Input !== undefined) {
      lines.push(
        <Input
          key={`flow-note:${MOCKUP_STEP}:${MOCKUP_ADJUST}`}
          label="Pedir ajuste:"
          placeholder="o que mudar no mockup"
          submitLabel="pedir ajuste"
          onSubmit={actions.noteFlow(flow.change, MOCKUP_STEP, MOCKUP_ADJUST)}
        />,
      )
    }
  } else if (step === RELEASE_STEP) {
    lines.push(
      <Text wrap="wrap">Aprove o plano de execução no diálogo do plan mode do app; a liberação vem só de lá.</Text>,
    )
    if (prep?.lastPlanFeedback !== undefined) {
      lines.push(<Text dimColor wrap="wrap">{`Você recusou o último plano: ${prep.lastPlanFeedback}`}</Text>)
    }
  }
  return lines
}
