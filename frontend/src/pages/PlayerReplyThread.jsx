import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import axios from "axios"

import { API_BASE } from "../api"
import ReturnHome from "../components/ReturnHome"

function decodeBase64Url(value) {
  const normalizedValue = value.replace(/-/g, "+").replace(/_/g, "/")
  const paddedValue = normalizedValue.padEnd(normalizedValue.length + ((4 - normalizedValue.length % 4) % 4), "=")

  return window.atob(paddedValue)
}

function decodeTokenPayload(token) {
  if (!token || typeof window === "undefined") {
    return null
  }

  try {
    const payloadSegment = token.split(".")[1]

    if (!payloadSegment) {
      return null
    }

    return JSON.parse(decodeBase64Url(payloadSegment))
  } catch (error) {
    console.error("Failed to decode profile token", error)
    return null
  }
}

function getDisplayName(email) {
  const [name = "Netric User"] = String(email || "Netric User").split("@")

  return name
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ") || "Netric User"
}

function getInitials(value) {
  const normalizedValue = String(value || "User")
  const [name = normalizedValue] = normalizedValue.split("@")
  const parts = name.split(/[._\s-]+/).filter(Boolean)
  const initials = parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join("")

  return initials || "U"
}

function getProfileStorageKey(email, token) {
  if (email && email !== "Unknown email") {
    return `netric:profile:${email}`
  }

  return token ? `netric:profile:${token}` : null
}

function readStoredProfile(email, token) {
  if (typeof window === "undefined") {
    return null
  }

  const cacheKey = getProfileStorageKey(email, token)

  if (!cacheKey) {
    return null
  }

  try {
    const rawProfile = window.localStorage.getItem(cacheKey)

    return rawProfile ? JSON.parse(rawProfile) : null
  } catch (error) {
    console.error("Failed to read stored profile", error)
    return null
  }
}

function normalizeProfile(data, fallbackUsername) {
  return {
    username: data?.username || fallbackUsername,
    image: data?.profile_image || data?.image || null,
  }
}

function formatRelativeTime(value, now = Date.now()) {
  const parsedDate = new Date(value)

  if (!value || Number.isNaN(parsedDate.getTime())) {
    return "Just now"
  }

  const diffSeconds = Math.max(0, Math.floor((now - parsedDate.getTime()) / 1000))
  const units = [
    { label: "year", seconds: 31536000 },
    { label: "month", seconds: 2592000 },
    { label: "week", seconds: 604800 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
  ]
  const matchedUnit = units.find(unit => diffSeconds >= unit.seconds)

  if (!matchedUnit) {
    return "Just now"
  }

  const count = Math.floor(diffSeconds / matchedUnit.seconds)

  return `${count} ${matchedUnit.label}${count === 1 ? "" : "s"} ago`
}

function CommentCard({ comment }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-gradient-to-br from-blue-500/25 to-emerald-400/20 text-sm font-semibold text-white">
          {comment.profile_image ? (
            <img
              src={comment.profile_image}
              alt={`${comment.username || "User"} profile`}
              className="h-full w-full object-cover"
            />
          ) : (
            getInitials(comment.username)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="font-semibold text-white">{comment.username || "Netric User"}</p>
              <p className="text-xs text-slate-500">{formatRelativeTime(comment.created_at)}</p>
            </div>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
            {comment.text}
          </p>
        </div>
      </div>
    </article>
  )
}

function updateReplyTree(replies, targetReplyId, updater) {
  return (Array.isArray(replies) ? replies : []).map(reply => {
    const nextReplies = updateReplyTree(reply.replies, targetReplyId, updater)
    const nextReply = {
      ...reply,
      replies: nextReplies,
      reply_count: nextReplies.length,
    }

    return reply.id === targetReplyId ? updater(nextReply) : nextReply
  })
}

function removeReplyFromTree(replies, targetReplyId) {
  return (Array.isArray(replies) ? replies : [])
    .filter(reply => reply.id !== targetReplyId)
    .map(reply => {
      const nextReplies = removeReplyFromTree(reply.replies, targetReplyId)

      return {
        ...reply,
        replies: nextReplies,
        reply_count: nextReplies.length,
      }
    })
}

function findReplyInTree(replies, targetReplyId) {
  for (const reply of Array.isArray(replies) ? replies : []) {
    if (reply.id === targetReplyId) {
      return reply
    }

    const foundReply = findReplyInTree(reply.replies, targetReplyId)

    if (foundReply) {
      return foundReply
    }
  }

  return null
}

function ReplyCard({
  reply,
  onLike,
  onDelete,
  onOpenComposer,
  likingReplyId,
  deletingReplyId,
  isParent = false,
  isFocused = false,
  depth = 0,
}) {
  const avatarSize = isParent ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs"

  return (
    <article
      className={`${depth > 0 ? "border-l border-white/10 pl-4" : ""} ${
        isFocused ? "rounded-2xl bg-white/[0.04] p-3 ring-1 ring-blue-300/25" : ""
      }`}
      style={{ marginLeft: depth > 0 ? `${Math.min(depth * 28, 168)}px` : undefined }}
    >
      <div className="flex items-start gap-3">
        <div className={`flex ${avatarSize} shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-gradient-to-br from-blue-500/25 to-emerald-400/20 font-semibold text-white`}>
          {reply.profile_image ? (
            <img
              src={reply.profile_image}
              alt={`${reply.username || "User"} profile`}
              className="h-full w-full object-cover"
            />
          ) : (
            getInitials(reply.username)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className={`${isParent ? "font-semibold" : "text-sm font-semibold"} text-white`}>{reply.username || "Netric User"}</p>
              <p className="text-xs text-slate-500">{formatRelativeTime(reply.created_at)}</p>
            </div>
            {reply.can_delete && (
              <button
                type="button"
                onClick={() => onDelete(reply.id)}
                disabled={deletingReplyId === reply.id}
                className="rounded-lg border border-rose-300/20 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-100 transition-colors duration-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingReplyId === reply.id ? "Deleting" : "Delete"}
              </button>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
            {reply.text}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onLike(reply.id)}
              disabled={likingReplyId === reply.id}
              aria-label={reply.liked_by_current_user ? "Remove thumbs up" : "Give thumbs up"}
              title={reply.liked_by_current_user ? "Remove thumbs up" : "Give thumbs up"}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2.5 text-xs font-medium transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-60 ${
                reply.liked_by_current_user
                  ? "border-blue-300/50 text-blue-200"
                  : "border-white/10 text-slate-300 hover:bg-white/[0.08]"
              }`}
            >
              <span aria-hidden="true" className="text-sm">
                👍
              </span>
              <span>{Number(reply.like_count || 0)}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenComposer(reply.id)}
              aria-label="Comment on this"
              title="Comment on this"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-slate-300 transition-colors duration-300 hover:bg-white/[0.08]"
            >
              <span aria-hidden="true" className="text-sm text-slate-400">💬</span>
              <span>{Number(reply.reply_count || 0)}</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function ReplyTree({
  replies,
  focusedReplyId,
  onLike,
  onDelete,
  onOpenComposer,
  likingReplyId,
  deletingReplyId,
  depth = 0,
}) {
  return (
    <>
      {(Array.isArray(replies) ? replies : []).map(reply => (
        <div key={reply.id || `${reply.username}-${reply.created_at}`} className="grid gap-3">
          <ReplyCard
            reply={reply}
            onLike={onLike}
            onDelete={onDelete}
            onOpenComposer={onOpenComposer}
            likingReplyId={likingReplyId}
            deletingReplyId={deletingReplyId}
            isFocused={reply.id === focusedReplyId}
            depth={depth}
          />
          <ReplyTree
            replies={reply.replies}
            focusedReplyId={focusedReplyId}
            onLike={onLike}
            onDelete={onDelete}
            onOpenComposer={onOpenComposer}
            likingReplyId={likingReplyId}
            deletingReplyId={deletingReplyId}
            depth={depth + 1}
          />
        </div>
      ))}
    </>
  )
}

export default function PlayerReplyThread() {
  const navigate = useNavigate()
  const { id, commentId, replyId } = useParams()
  const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null
  const currentUserPayload = decodeTokenPayload(token)
  const currentUserEmail = currentUserPayload?.sub || "Unknown email"
  const [thread, setThread] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [replyDraft, setReplyDraft] = useState("")
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [activeReplyId, setActiveReplyId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [likingReplyId, setLikingReplyId] = useState(null)
  const [deletingReplyId, setDeletingReplyId] = useState(null)
  const [currentUserProfile, setCurrentUserProfile] = useState(() => {
    const localProfile = readStoredProfile(currentUserEmail, token)

    return normalizeProfile(localProfile, getDisplayName(currentUserEmail))
  })

  const currentUsername = currentUserProfile.username || getDisplayName(currentUserEmail)
  const currentProfileImage = currentUserProfile.image || null

  useEffect(() => {
    const localProfile = readStoredProfile(currentUserEmail, token)
    setCurrentUserProfile(normalizeProfile(localProfile, getDisplayName(currentUserEmail)))

    if (!token) {
      return undefined
    }

    let ignore = false

    axios
      .get(`${API_BASE}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(res => {
        if (!ignore) {
          setCurrentUserProfile(normalizeProfile(res.data, getDisplayName(currentUserEmail)))
        }
      })
      .catch(error => {
        if (!ignore) {
          console.error(error)
        }
      })

    return () => {
      ignore = true
    }
  }, [currentUserEmail, token])

  useEffect(() => {
    let ignore = false

    setLoading(true)
    setError("")

    axios
      .get(`${API_BASE}/player/${id}/comments/${commentId}/replies/${replyId}/thread`, token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined
      )
      .then(res => {
        if (!ignore) {
          setThread(res.data || null)
          setReplyDraft("")
          setIsComposerOpen(false)
          setActiveReplyId(null)
        }
      })
      .catch(err => {
        console.error(err)

        if (!ignore) {
          setThread(null)
          setError(err.response?.data?.detail || "Unable to load this thread right now.")
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [id, commentId, replyId, token])

  async function handleReplySubmit(event) {
    event.preventDefault()

    const trimmedReply = replyDraft.trim()

    if (!trimmedReply) {
      return
    }

    if (!token) {
      navigate("/login")
      return
    }

    setSubmitting(true)
    setError("")

    try {
      const targetReplyId = activeReplyId || replyId
      const res = await axios.post(
        `${API_BASE}/player/${id}/comments/${commentId}/replies/${targetReplyId}/replies`,
        {
          text: trimmedReply,
          username: currentUsername,
          profile_image: currentProfileImage,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const createdReply = res.data?.reply

      if (createdReply) {
        setThread(currentThread => {
          const appendReply = reply => {
            const nextReplies = [...(Array.isArray(reply.replies) ? reply.replies : []), createdReply]

            return {
              ...reply,
              replies: nextReplies,
              reply_count: nextReplies.length,
            }
          }
          const nextReplies = updateReplyTree(currentThread.replies, targetReplyId, appendReply)
          const nextFocusedReply = findReplyInTree(nextReplies, replyId) || currentThread.reply

          return {
            ...currentThread,
            replies: nextReplies,
            reply: nextFocusedReply,
          }
        })
      }

      setReplyDraft("")
      setIsComposerOpen(false)
      setActiveReplyId(null)
    } catch (err) {
      console.error(err)
      setError(err.response?.data?.detail || "Unable to post that reply right now.")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleReplyLike(targetReplyId) {
    if (!token) {
      navigate("/login")
      return
    }

    if (!targetReplyId || likingReplyId === targetReplyId) {
      return
    }

    setLikingReplyId(targetReplyId)
    setError("")

    try {
      const res = await axios.post(
        `${API_BASE}/player/${id}/comments/${commentId}/replies/${targetReplyId}/like`,
        null,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      setThread(currentThread => {
        const updateReply = reply => ({
          ...reply,
          liked_by_current_user: Boolean(res.data?.liked),
          like_count: Number(res.data?.like_count ?? reply.like_count ?? 0),
        })
        const nextReplies = updateReplyTree(currentThread.replies, targetReplyId, updateReply)
        const nextReply = findReplyInTree(nextReplies, replyId) || currentThread.reply

        return {
          ...currentThread,
          replies: nextReplies,
          reply: nextReply,
        }
      })
    } catch (err) {
      console.error(err)
      setError(err.response?.data?.detail || "Unable to update that thumbs up right now.")
    } finally {
      setLikingReplyId(null)
    }
  }

  async function handleDeleteReply(targetReplyId) {
    if (!token || !targetReplyId) {
      return
    }

    setDeletingReplyId(targetReplyId)
    setError("")

    try {
      await axios.delete(`${API_BASE}/player/${id}/comments/${commentId}/replies/${targetReplyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (targetReplyId === replyId) {
        navigate(`/player/${id}?tab=comments`)
        return
      }

      setThread(currentThread => {
        const nextReplies = removeReplyFromTree(currentThread.replies, targetReplyId)

        return {
          ...currentThread,
          replies: nextReplies,
          reply: findReplyInTree(nextReplies, replyId) || currentThread.reply,
        }
      })
    } catch (err) {
      console.error(err)
      setError(err.response?.data?.detail || "Unable to delete that reply right now.")
    } finally {
      setDeletingReplyId(null)
    }
  }

  const replies = Array.isArray(thread?.replies)
    ? thread.replies
    : (thread?.reply ? [thread.reply] : [])
  const focusedReply = findReplyInTree(replies, replyId) || thread?.reply
  const activeReply = findReplyInTree(replies, activeReplyId) || focusedReply

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(`/player/${id}?tab=comments`)}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors duration-300 hover:bg-white/[0.08]"
          >
            Back to comments
          </button>
          <ReturnHome className="text-sm" />
        </div>

        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-xl shadow-black/20">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-blue-200/80">Reply thread</p>
          <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{thread?.player_name || "Player comments"}</h1>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-dashed border-white/12 bg-slate-900/55 p-8 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-400/30 border-t-blue-300" />
            <p className="text-sm font-medium text-white">Loading thread</p>
          </div>
        ) : error && !thread ? (
          <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 p-5 text-sm text-rose-100">
            {error}
          </div>
        ) : focusedReply ? (
          <>
            {error && (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                {error}
              </div>
            )}

            <section className="rounded-3xl border border-white/10 bg-slate-900/55 p-4 shadow-xl shadow-black/20">
              <div className="grid gap-4">
                {thread.comment && (
                  <CommentCard comment={thread.comment} />
                )}

                <div className="grid gap-3">
                  <ReplyTree
                    replies={replies}
                    focusedReplyId={replyId}
                    onLike={handleToggleReplyLike}
                    onDelete={handleDeleteReply}
                    onOpenComposer={targetReplyId => {
                      setActiveReplyId(targetReplyId)
                      setIsComposerOpen(true)
                    }}
                    likingReplyId={likingReplyId}
                    deletingReplyId={deletingReplyId}
                    depth={1}
                  />
                </div>
              </div>
            </section>

            {isComposerOpen && (
              <form onSubmit={handleReplySubmit} className="rounded-2xl border border-white/10 bg-slate-900/55 p-4">
                <textarea
                  value={replyDraft}
                  onChange={event => setReplyDraft(event.target.value)}
                  maxLength={600}
                  rows={3}
                  placeholder={`Write a reply to ${activeReply?.username || "Netric User"}...`}
                  className="w-full resize-none rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition-colors duration-300 placeholder:text-slate-500 focus:border-blue-300/50"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">{replyDraft.length}/600</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setReplyDraft("")
                        setIsComposerOpen(false)
                        setActiveReplyId(null)
                      }}
                      disabled={submitting}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors duration-300 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !replyDraft.trim()}
                      className="rounded-lg bg-white px-4 py-1.5 text-xs font-semibold text-slate-950 transition-all duration-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white"
                    >
                      {submitting ? "Posting" : "Post"}
                    </button>
                  </div>
                </div>
              </form>
            )}

          </>
        ) : null}
      </div>
    </div>
  )
}
