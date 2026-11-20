(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const regions = () => [...document.querySelectorAll('input[name="region"]:checked')].map(input => input.value);
  const on = id => $(id).checked;
  const value = id => $(id).value.trim();
  const needed = (text, label) => text || '[' + label + ' 입력 필요]';
  const names = {kr:'한국',eu:'EU',us:'미국'};
  const links = {
    kr: {title:'개인정보 보호법 (국가법령정보센터)',url:'https://www.law.go.kr/법령/개인정보보호법'},
    eu: {title:'GDPR (EUR-Lex)',url:'https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng'},
    us: {title:'CCPA/CPRA (California Privacy Protection Agency)',url:'https://cppa.ca.gov/regulations/'},
    cookies: {title:'ePrivacy Directive Article 5(3) (EUR-Lex)',url:'https://eur-lex.europa.eu/eli/dir/2002/58/oj/eng'}
  };
  let current = [];

  function item(title, description, draft, refs, warning) {
    current.push({title,description,draft,refs,warning:warning||''});
  }

  function standardRefs(area, refs) {
    return area.map(key => ({...links[key],detail:(refs[key]||'관련 조항 확인')}));
  }

  function build() {
    current = [];
    const area = regions();
    if (!area.length) return current;
    const service = needed(value('service'),'서비스 이름');
    const owner = needed(value('owner'),'운영자 이름');
    const email = needed(value('email'),'문의 이메일');
    const data = needed(value('dataTypes'),'수집하거나 처리하는 정보');
    const purpose = needed(value('purposes'),'처리 목적');
    const retention = needed(value('retention'),'보유 기간 및 삭제 기준');

    item('개인정보 처리 안내와 문의',
      '처리 항목, 목적, 보유 기간, 담당자 등을 확인할 수 있는 안내입니다.',
      service+'의 운영자는 '+owner+'입니다.\n처리하는 정보: '+data+'\n처리 목적: '+purpose+'\n보유 및 삭제 기준: '+retention+'\n개인정보 관련 문의: '+email,
      standardRefs(area,{kr:'제30조',eu:'제12~14조',us:'캘리포니아 CCPA/CPRA 개인정보 고지 요건'}),
      '이 문장만으로 완전한 개인정보처리방침이 되지 않습니다. 서비스 및 관할별 추가 기재사항을 검토하세요.');

    if (on('local')) item('기기나 브라우저에 저장',
      '브라우저에 저장하는 데이터와 서버가 수집할 수 있는 정보를 구분하세요.',
      service+'에서 사용자가 입력한 내용은 이 브라우저에서 처리되고 저장됩니다. 브라우저 데이터를 삭제하면 기록이 사라질 수 있고 다른 기기와 자동 동기화되지 않습니다.\n[실제 서버 전송 여부와 보관 기술을 확인한 후 문구 확정]',
      standardRefs(area,{kr:'제30조: 처리 방식 고지 검토',eu:'제13조: 개인정보 처리 정보 제공',us:'관련 개인정보 고지 요건'}),
      '브라우저 저장만 사용하더라도 접속 로그, 외부 스크립트나 호스팅 서비스으로 전송되는 정보가 있을 수 있어요.');

    if (on('account')) item('계정과 로그인',
      '계정 운영에 필요한 정보, 법적 근거, 삭제와 탈퇴 기준을 확인하세요.',
      service+'은 계정 관리와 서비스 제공을 위하여 [계정에 사용하는 정보]를 처리합니다. 계정 탈퇴 및 정보 삭제에 관한 안내는 [실제 절차]에서 확인할 수 있습니다.',
      standardRefs(area,{kr:'제15조: 수집 및 이용',eu:'제6조: 적법한 처리 근거, 제13조: 고지',us:'계정 데이터의 개인정보 고지 및 권리 요건'}),
      '모든 개인정보 처리가 반드시 동의를 근거로 하는 것은 아닙니다.');

    if (on('analytics')) item('분석 도구와 쿠키',
      '사용 중인 분석 도구의 쿠키, 식별자, 전송 정보 및 동의 여부를 확인하세요.',
      service+'은 [실제 분석 도구]를 이용해 [측정 정보]를 분석합니다. 쿠키나 유사 기술이 사용되는 경우 목적과 선택하거나 거부하는 방법을 [실제 안내 위치]에 설명합니다.',
      [...standardRefs(area,{kr:'제30조 등: 개인정보 처리 고지',eu:'GDPR 제6조와 제13조',us:'추적 기술 및 주별 고지와 거부권 검토'}),...(area.includes('eu')?[{...links.cookies,detail:'제5조 제3항'}]:[])],
      'EU의 필수적이지 않은 기기에 정보를 저장하거나 접근하는 기술은 GDPR 외 ePrivacy 관련 규정도 검토해야 합니다.');

    if (on('third')) item('외부 처리업체와 위탁',
      '제3자 제공과 처리 위탁을 구별하고 업체, 업무, 계약 구조를 확인하세요.',
      service+'은 [구체적인 업무]를 수행하기 위해 '+needed(value('vendors'),'위탁 업체와 업무')+'를 이용합니다. 처리되는 정보와 업무 범위는 [확인 후 기재]합니다.',
      standardRefs(area,{kr:'제26조: 개인정보 처리 위탁',eu:'제28조: 처리자',us:'서비스 제공업체 계약과 고지 검토'}),
      '실제 위탁과 제3자 제공 관계 및 적용되는 계약 요건을 먼저 확인하세요.');

    if (on('payment')) item('결제와 환불 안내',
      '판매 가격, 청약철회와 환불 및 정기 결제 해지 조건은 별도로 검토하세요.',
      service+'의 결제 금액과 서비스 제공 조건은 구매 전에 확인할 수 있습니다. 취소, 환불, 구독 해지 기준은 [실제 운영 정책 및 적용 법률에 맞춰 기재]합니다.',
      standardRefs(area,{kr:'전자상거래법 등 추가 검토 필요',eu:'소비자보호 관련 규정 별도 검토',us:'주별 소비자보호 규정 별도 검토'}),
      '링크는 개인정보법 관련 출처이며 결제와 환불에 관한 전문 법률 근거를 대체하지 않습니다.');

    if (on('marketing')) item('광고와 마케팅 선택',
      '광고성 메시지 수신과 개인정보의 맞춤형 광고 활용 여부를 각각 구분하세요.',
      service+'은 [마케팅 목적]으로 [이용하는 정보]를 사용할 수 있습니다. 이용자는 [실제로 제공하는 수신 거부 및 선택 변경 방법]에서 설정을 변경할 수 있습니다.',
      standardRefs(area,{kr:'광고성 정보 전송 및 개인정보 처리 별도 검토',eu:'GDPR 및 ePrivacy 검토',us:'주별 판매 및 공유 거부권 검토'}),
      '추적 기술, 메시지 발송 동의, 맞춤형 광고의 법적 요건을 분리해서 확인하세요.');

    if (on('transfer')) item('개인정보 국외 이전',
      '이전받는 업체와 국가, 목적, 법적 근거, 보유 기간을 확인하세요.',
      service+'은 [이전 목적]을 위해 '+needed(value('transferTo'),'이전 국가와 수령자')+'에게 [이전 정보]를 전송할 수 있습니다. 이전 방식과 근거, 보유 기간은 [실제 정보 입력]을 참고해 주세요.',
      standardRefs(area,{kr:'제28조의8 등: 국외 이전',eu:'제44~49조: 제3국 이전',us:'주별 이전 및 공유 규정 검토'}),
      '선택했다고 국외 이전이 적법해지는 것은 아닙니다. 계약, 보호조치, 고지 등 요건을 확인하세요.');

    if (on('children')) item('아동 이용자 보호',
      '연령과 보호자 동의, 안내 방식이 관할 지역에 따라 다릅니다.',
      service+'은 아동 이용자를 위한 [연령 확인 및 보호 절차]를 운영합니다. 보호자는 '+email+'로 관련 내용을 문의할 수 있습니다.',
      standardRefs(area,{kr:'제22조의2 등: 아동의 개인정보 보호',eu:'제8조: 아동의 동의에 적용되는 조건',us:'COPPA 등 아동 관련 법률 별도 검토'}),
      '아동의 연령 요건과 적용 범위는 국가와 서비스 유형에 따라 다릅니다.');

    if (on('automated')) item('자동화된 결정과 권리',
      '중대한 효과를 발생시키는 자동화된 처리인지 확인하고 설명 및 거부권 등을 검토하세요.',
      service+'은 [자동화된 결정의 실제 목적과 방식]에 따라 [대상 업무]를 처리할 수 있습니다. 이용자가 관련 내용을 문의하거나 권리를 행사하는 방법은 [실제 절차]에서 확인할 수 있습니다.',
      standardRefs(area,{kr:'제37조의2: 자동화된 결정에 대한 권리',eu:'제22조: 자동화된 개별 의사결정',us:'적용되는 주별 자동화 결정 규정 검토'}),
      '단순한 자동 계산이나 추천이 곧바로 법률상 규제 대상인 것은 아닙니다.');

    item('개인정보 관련 권리',
      '열람, 정정, 삭제 등 행사 방법을 실제 운영 절차와 연결하세요.',
      '이용자는 '+email+'로 개인정보에 관한 문의와 법령에 따른 권리 행사 요청을 할 수 있습니다. 구체적인 처리 절차는 [실제 접수 및 본인 확인 절차]에 따릅니다.',
      standardRefs(area,{kr:'제35~37조: 정보주체 권리',eu:'제15~22조: 정보주체 권리',us:'주별 소비자 권리 및 적용 범위'}),
      '실제 적용되는 권리와 처리기한과 거부 사유가 지역마다 다를 수 있습니다.');

    if (area.includes('us')) item('미국 주별 적용 범위',
      '미국은 단일 포괄법 체계가 아니며, 특정 주법의 사업자 적용 기준을 확인해야 합니다.',
      '미국 이용자에 관한 추가 안내는 [적용되는 주법과 사업자 요건 확인 후 작성]합니다.',
      [{...links.us,detail:'CCPA/CPRA 적용 사업자 및 고지 요건 확인'}],
      '선택한 범위: '+$('usArea').selectedOptions[0].textContent+'. 선택만으로 CCPA 적용이 확정되지 않습니다.');

    return current;
  }

  function card(section) {
    const article = document.createElement('article');
    article.className = 'clause';
    const header = document.createElement('div');
    header.className = 'clause-header';
    const heading = document.createElement('h3');
    heading.textContent = section.title;
    header.append(heading);
    const description = document.createElement('p');
    description.className = 'description';
    description.textContent = section.description;
    const sources = document.createElement('div');
    sources.className = 'sources';
    for (const ref of section.refs) {
      const a = document.createElement('a');
      a.href = ref.url;
      a.textContent = ref.title+' ('+ref.detail+') 공식 원문';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.referrerPolicy = 'no-referrer';
      sources.append(a);
    }
    const label = document.createElement('p');
    label.className = 'draft-label';
    label.textContent = '사용할 문구 초안';
    const draft = document.createElement('div');
    draft.className = 'draft';
    draft.textContent = section.draft;
    const buttons = document.createElement('div');
    buttons.className = 'clause-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '이 문장 복사';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(section.draft);
        copy.textContent = '복사했어요';
      } catch (err) {
        copy.textContent = '복사할 수 없어요';
      }
    });
    buttons.append(copy);
    article.append(header,description,sources,label,draft,buttons);
    if (section.warning) {
      const warning = document.createElement('p');
      warning.className = 'description';
      warning.style.marginTop = '12px';
      warning.textContent = '확인할 점: '+section.warning;
      article.append(warning);
    }
    return article;
  }

  function render() {
    $('usDetail').hidden = !regions().includes('us');
    $('thirdDetail').hidden = !on('third');
    $('transferDetail').hidden = !on('transfer');
    const sections = build();
    $('summary').textContent = regions().length
      ? '선택한 지역: '+regions().map(key=>names[key]).join(', ')+' | 검토 항목 '+sections.length+'개'
      : '지역을 한 곳 이상 선택하면 관련 조항과 문구가 나타나요.';
    $('resultsList').replaceChildren(...sections.map(card));
    const checks = $('checks');
    checks.replaceChildren();
    if (!sections.length) return;
    const heading = document.createElement('h3');
    heading.textContent = '사용 전 확인할 사항';
    const ul = document.createElement('ul');
    const messages = [
      '대괄호로 표시된 항목을 실제 운영 정보로 교체해 주세요.',
      '공식 법률 링크를 통해 현재 적용되는 법령, 예외 및 세부 요건을 확인해 주세요.',
      '서비스의 실제 수집 항목, 저장 및 삭제 방식, 외부 도구와 서버 전송 여부를 확인해 주세요.',
      '문구가 일부 표시되지 않아도 해당 의무가 없다는 뜻은 아닙니다.',
      '이 결과는 개인정보처리방침과 이용약관 전체가 아니며 법률 자문이 아닙니다.'
    ];
    if (regions().includes('us')) messages.push('미국 주별 적용 범위와 사업자 요건을 별도로 확인해 주세요.');
    if (regions().includes('eu')) messages.push('EU 대상 서비스는 필요한 경우 현지 언어, 감독기관과 역외 적용 요건을 확인해 주세요.');
    for (const message of messages) {
      const li = document.createElement('li');
      li.textContent = message;
      ul.append(li);
    }
    checks.append(heading,ul);
  }

  $('config').addEventListener('input', () => {
    $('copyAll').textContent = '결과 복사';
    render();
  });
  $('config').addEventListener('change', render);
  $('config').addEventListener('submit', event => event.preventDefault());
  $('reset').addEventListener('click', () => {
    $('config').reset();
    render();
  });
  $('copyAll').addEventListener('click', async () => {
    const sections = build();
    if (!sections.length) return;
    const text = [
      'My Privacy & Terms - 관련 법률 및 문구 초안',
      '선택 지역: '+regions().map(key=>names[key]).join(', '),
      '배포 전 반드시 실제 정보 및 법률 요건 검토',
      ...sections.flatMap(section => [
        '', '## '+section.title,
        section.description,
        '공식 근거: '+section.refs.map(ref=>ref.title+' '+ref.detail+' '+ref.url).join(' / '),
        '문구 초안:', section.draft, '확인: '+section.warning
      ])
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      $('copyAll').textContent = '결과를 복사했어요';
    } catch (err) {
      $('copyAll').textContent = '복사하지 못했어요';
    }
  });
  render();
})();
