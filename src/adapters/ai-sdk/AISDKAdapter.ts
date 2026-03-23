import { ToolCallingAdapter, type ToolCallingAdapterOptions } from "../tool-calling";

import { AISDKToolCallingModel, type AISDKToolCallingModelOptions } from "./model";

export interface AISDKAdapterOptions
  extends Omit<ToolCallingAdapterOptions, "toolFormat" | "model">,
    AISDKToolCallingModelOptions {}

export class AISDKAdapter extends ToolCallingAdapter {
  public constructor(options: AISDKAdapterOptions) {
    const {
      model,
      generateText,
      toolFactory,
      ...adapterOptions
    } = options;

    super({
      ...adapterOptions,
      model: new AISDKToolCallingModel({
        model,
        generateText,
        toolFactory,
      }),
      toolFormat: "openai",
    });
  }
}
