import type { Editor } from 'superdoc';
import type { TrackChangeInfo } from 'superdoc/ui';

type TrackedChangesControllerOptions = {
  editor: Editor;
  editorHost: HTMLElement;
  human: {
    name: string;
    email: string;
  };
};

const CONTROLLER_CLASS = 'tracked-changes-controller';
const HIDE_HUMAN_TRACKED_CHANGES_CLASS = 'hide-human-tracked-changes';

export class TrackedChangesController {
  readonly #editor: Editor;
  readonly #editorHost: HTMLElement;
  readonly #human: TrackedChangesControllerOptions['human'];

  constructor({ editor, editorHost, human }: TrackedChangesControllerOptions) {
    this.#editor = editor;
    this.#editorHost = editorHost;
    this.#human = human;
    this.#editorHost.classList.add(CONTROLLER_CLASS);
  }

  async getTrackedChanges(): Promise<TrackChangeInfo[]> {
    const result = await this.#editor.doc.trackChanges.list({
      limit: 250,
      offset: 0,
    });

    return [...result.items].sort(
      (left, right) => new Date(right.date ?? 0).getTime() - new Date(left.date ?? 0).getTime(),
    );
  }

  isHumanTrackedChange(trackedChange: TrackChangeInfo) {
    return trackedChange.authorEmail === this.#human.email || trackedChange.author === this.#human.name;
  }

  filterVisibleTrackedChanges(trackedChanges: TrackChangeInfo[], hideHumanTrackedChanges: boolean) {
    return hideHumanTrackedChanges
      ? trackedChanges.filter((trackedChange) => !this.isHumanTrackedChange(trackedChange))
      : trackedChanges;
  }

  setHumanTrackedChangesVisible(visible: boolean) {
    this.#editorHost.classList.toggle(HIDE_HUMAN_TRACKED_CHANGES_CLASS, !visible);
  }

  destroy() {
    this.#editorHost.classList.remove(CONTROLLER_CLASS, HIDE_HUMAN_TRACKED_CHANGES_CLASS);
  }
}
