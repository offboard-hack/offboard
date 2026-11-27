export type Right = {
  id: string;
  question: string;
  paragraphs: string[];
  points?: string[];
};

export const rightsDisclaimer =
  "Conteúdo informativo, baseado na legislação trabalhista brasileira. Não substitui orientação jurídica: seu caso pode ter regras diferentes por convenção coletiva ou por situação específica.";

export const rights: Right[] = [
  {
    id: "seguro-desemprego",
    question: "Tenho direito ao seguro-desemprego?",
    paragraphs: [
      "O seguro-desemprego é pago a quem é dispensado sem justa causa e não tem outra renda para se manter. Quem pede demissão, é dispensado por justa causa ou se desliga por acordo com a empresa não recebe o benefício.",
      "O número de parcelas vai de 3 a 5 e depende de quanto tempo você trabalhou com carteira assinada nos meses anteriores à dispensa e de quantas vezes já recebeu o benefício. O valor é calculado sobre a média dos seus últimos salários e fica entre o salário mínimo e um teto atualizado todo ano.",
    ],
    points: [
      "Você precisa ter recebido salários de empregador nos meses exigidos para a sua solicitação (quanto mais pedidos anteriores, maior a exigência).",
      "Não pode ter renda própria suficiente nem receber benefício da Previdência, exceto pensão por morte ou auxílio-acidente.",
      "O pedido pode ser feito do 7º ao 120º dia corrido depois da dispensa, pelo aplicativo Carteira de Trabalho Digital, pelo portal Gov.br ou em uma unidade do Sine ou da Superintendência Regional do Trabalho.",
      "Tenha em mãos o CPF, a Carteira de Trabalho e o termo de rescisão (TRCT).",
    ],
  },
  {
    id: "fgts",
    question: "Posso sacar o FGTS? Como funciona a multa de 40%?",
    paragraphs: [
      "Na dispensa sem justa causa você pode sacar todo o saldo do FGTS depositado pela empresa durante o contrato. Além disso, a empresa deve pagar uma multa de 40% sobre o total dos depósitos desse contrato, corrigidos. A multa é paga pela empresa e não sai do seu saldo.",
      "Os depósitos do mês da rescisão e do aviso prévio indenizado também entram no cálculo.",
    ],
    points: [
      "Pedido de demissão e dispensa por justa causa: não dão direito ao saque, e o valor continua na sua conta do FGTS.",
      "Acordo entre empresa e empregado: saque de até 80% do saldo e multa de 20%.",
      "Consulte o saldo e o saque pelo aplicativo FGTS ou em uma agência da Caixa Econômica Federal.",
    ],
  },
  {
    id: "aviso-previo",
    question: "Como funciona o aviso prévio?",
    paragraphs: [
      "O aviso prévio é de 30 dias e aumenta 3 dias para cada ano completo de trabalho na mesma empresa, até o máximo de 90 dias. Esse acréscimo vale em favor do empregado dispensado sem justa causa.",
      "Ele pode ser trabalhado ou indenizado. No trabalhado, você continua indo à empresa e tem direito a reduzir a jornada em 2 horas por dia ou a faltar 7 dias corridos, sem perder salário. No indenizado, a empresa dispensa você de trabalhar e paga o valor correspondente junto com a rescisão.",
    ],
    points: [
      "O período do aviso, inclusive o indenizado, conta como tempo de serviço para férias, 13º salário e FGTS.",
      "Se a empresa não avisar com antecedência, deve pagar o aviso indenizado.",
    ],
  },
  {
    id: "ferias",
    question: "Recebo férias na rescisão?",
    paragraphs: [
      "Sim. Férias vencidas, aquelas de um período de 12 meses de trabalho que você ainda não tirou, são sempre pagas, acrescidas de 1/3 constitucional. Se o prazo para a empresa conceder essas férias já tiver passado, elas devem ser pagas em dobro.",
      "As férias proporcionais correspondem a 1/12 por mês trabalhado desde o último período, também com acréscimo de 1/3. Meses com 15 dias ou mais de trabalho contam como mês inteiro. Elas são devidas na dispensa sem justa causa, no pedido de demissão e no acordo, mas não na dispensa por justa causa.",
    ],
  },
  {
    id: "decimo-terceiro",
    question: "E o 13º salário?",
    paragraphs: [
      "Você recebe o 13º proporcional ao ano em curso: 1/12 do salário por mês trabalhado, contando como mês inteiro a fração de 15 dias ou mais. O aviso prévio indenizado também entra na contagem.",
      "O 13º proporcional é devido na dispensa sem justa causa, no pedido de demissão e no acordo, mas não na dispensa por justa causa. Parcelas que você já recebeu naquele ano são descontadas.",
    ],
  },
  {
    id: "prazo-rescisao",
    question: "Qual é o prazo para receber a rescisão?",
    paragraphs: [
      "A empresa tem até 10 dias corridos, contados do término do contrato, para pagar as verbas rescisórias e entregar os documentos, seja o aviso trabalhado ou indenizado.",
      "Se o prazo for descumprido, a empresa deve pagar uma multa equivalente a um salário seu, além de multa administrativa. Em caso de atraso, procure o RH, o sindicato da categoria ou a Superintendência Regional do Trabalho.",
    ],
  },
  {
    id: "exame-demissional",
    question: "Preciso fazer o exame demissional?",
    paragraphs: [
      "Sim, a empresa deve realizar o exame médico demissional, por conta dela, até a data da rescisão. Ele confirma sua condição de saúde ao fim do contrato e gera o ASO (Atestado de Saúde Ocupacional).",
      "O exame pode ser dispensado se o seu último exame ocupacional tiver sido feito há menos de 135 dias, em empresas de grau de risco 1 ou 2, ou há menos de 90 dias, nos graus de risco 3 ou 4.",
    ],
  },
  {
    id: "rescisao-trct",
    question: "O que é o TRCT e preciso homologar a rescisão?",
    paragraphs: [
      "O TRCT (Termo de Rescisão do Contrato de Trabalho) lista cada verba paga ou descontada na saída: saldo de salário, aviso prévio, férias, 13º, multa do FGTS e descontos. Confira os valores antes de assinar.",
      "Desde a Reforma Trabalhista de 2017, a rescisão não precisa mais ser homologada no sindicato. A quitação vale apenas para as parcelas discriminadas no termo, e você pode registrar ressalvas ao assinar se discordar de algum valor.",
    ],
    points: [
      "Peça cópia do TRCT assinado e guarde-a.",
      "Além do TRCT, a empresa entrega as guias para o saque do FGTS e para o seguro-desemprego, quando cabíveis, e anota a baixa na Carteira de Trabalho.",
    ],
  },
  {
    id: "plano-de-saude",
    question: "Posso manter o plano de saúde da empresa?",
    paragraphs: [
      "Se você pagava mensalidade pelo plano empresarial e foi dispensado sem justa causa, a Lei 9.656/1998, art. 30, garante manter o plano nas mesmas condições de cobertura, desde que assuma o pagamento integral, incluindo a parte que a empresa pagava.",
      "O direito dura 1/3 do tempo em que você participou do plano, com mínimo de 6 e máximo de 24 meses. Você deve manifestar a opção por escrito em até 30 dias após a empresa informar esse direito, geralmente no aviso de dispensa.",
    ],
    points: [
      "Quem só pagava coparticipação, sem mensalidade, não tem esse direito.",
      "A dispensa por justa causa não garante a continuidade.",
      "Quem pede demissão não tem esse direito.",
      "O direito se encerra se a empresa deixar de oferecer o plano a todos os empregados.",
    ],
  },
];
