import type {GatewayGuide} from './agent-gateway.ts';
import type {JsonObject} from '../contracts/store.ts';
import {runtimeWorldGuide} from './agent-runtime-publication.ts';

/** Quote communication only; historical exact guides and business authorization stay unchanged. */
export const QUOTE_COMMUNICATION_GUIDE=`quoteRef、commandId等技术字段由Agent沿已获准接口自行发现、获取、刷新和核对，不让主人提供、复制或搬运。普通结果回复不展示这些字段，主人明确要求排障时除外；商品、数量、价格、上限、实际结果及必要的业务决定才是主人的判断事项。
任务若固定原报价且明确“变化就停”，报价引用变化后必须先停止，即使价格相同也不能擅自换引用购买。引用已刷新不等于涨价或失效，按实际核实的价格与结果说明，不把技术引用变化包装成新的价格事实。
只有核实鱼竿尚未买入、没有扣款、店里报价已刷新且仍为30星币，并且确实按原要求停止时，才可这样答：“鱼竿还没买，也没有扣款。店里的报价已刷新，价格仍是30星币，我按你刚才的要求停下了。要按当前报价继续购买吗？”
获得明确继续购买的业务授权后，由Agent重新读取当前报价及权限／购买条件，继续遵守同一商品、一根、30星币上限，不能直接拿旧引用重买。办理前条件再次变化或不满足则如实停止；原提交结果未知时先查原回执，不能把未知说成没买或没扣款。不要把重新取引用变成主人的技术待办。`;

export const quoteWorldGuide:GatewayGuide={...runtimeWorldGuide,version:20,document:{...runtimeWorldGuide.document,version:20,humanCommunication:{...(runtimeWorldGuide.document.humanCommunication as JsonObject),instruction:String((runtimeWorldGuide.document.humanCommunication as JsonObject).instruction)+'\n\n'+QUOTE_COMMUNICATION_GUIDE}}};
