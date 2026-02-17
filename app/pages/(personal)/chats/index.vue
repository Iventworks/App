<script setup lang="ts">
interface Message {
    id: number
    text: string
    timestamp: Date
    senderId: number
    senderName: string
    isMe: boolean
}

interface Chat {
    id: number
    name: string
    avatar: string
    lastMessage: string
    timestamp: Date
    unreadCount: number
    online: boolean
}

// Mock data für Chats
const chats = ref<Chat[]>([
    {
        id: 1,
        name: 'Lukas Pohl',
        avatar: 'https://i.pravatar.cc/150?img=12',
        lastMessage: 'Können wir das Planungstreffen für young+free auf nächste Woche verschieben?',
        timestamp: new Date(Date.now() - 1000 * 60 * 5),
        unreadCount: 2,
        online: true
    },
    {
        id: 2,
        name: 'Miriam Lohrey',
        avatar: 'https://i.pravatar.cc/150?img=5',
        lastMessage: 'Die Teilnehmerliste für Crottendorf ist fertig',
        timestamp: new Date(Date.now() - 1000 * 60 * 30),
        unreadCount: 0,
        online: true
    },
    {
        id: 3,
        name: 'Team young+free Crottendorf',
        avatar: 'https://i.pravatar.cc/150?img=20',
        lastMessage: 'Neue Aufgabe: Programm für Samstag erstellen',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
        unreadCount: 3,
        online: false
    },
    {
        id: 4,
        name: 'Lisa Frischmuth',
        avatar: 'https://i.pravatar.cc/150?img=1',
        lastMessage: 'Können wir die Materialbestellung besprechen?',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5),
        unreadCount: 0,
        online: false
    },
    {
        id: 5,
        name: 'Jesko Bahlcke',
        avatar: 'https://i.pravatar.cc/150?img=13',
        lastMessage: 'Bis morgen beim Treffen!',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
        unreadCount: 0,
        online: false
    }
])

// Mock data für Nachrichten
const messages = ref<Record<number, Message[]>>({
    1: [
        {
            id: 1,
            text: 'Hi! Hast du schon die neuesten Updates für das young+free Camp gesehen?',
            timestamp: new Date(Date.now() - 1000 * 60 * 15),
            senderId: 1,
            senderName: 'Lukas Pohl',
            isMe: false
        },
        {
            id: 2,
            text: 'Ja, ich habe sie mir angesehen. Sieht sehr gut aus!',
            timestamp: new Date(Date.now() - 1000 * 60 * 12),
            senderId: 0,
            senderName: 'Ich',
            isMe: true
        },
        {
            id: 3,
            text: 'Können wir das Planungstreffen für young+free auf nächste Woche verschieben?',
            timestamp: new Date(Date.now() - 1000 * 60 * 5),
            senderId: 1,
            senderName: 'Lukas Pohl',
            isMe: false
        }
    ],
    2: [
        {
            id: 1,
            text: 'Wann ist das nächste Planungstreffen für Crottendorf?',
            timestamp: new Date(Date.now() - 1000 * 60 * 45),
            senderId: 0,
            senderName: 'Ich',
            isMe: true
        },
        {
            id: 2,
            text: 'Am 16. Januar um 18:00 Uhr',
            timestamp: new Date(Date.now() - 1000 * 60 * 40),
            senderId: 2,
            senderName: 'Miriam Lohrey',
            isMe: false
        },
        {
            id: 3,
            text: 'Die Teilnehmerliste für Crottendorf ist fertig',
            timestamp: new Date(Date.now() - 1000 * 60 * 30),
            senderId: 2,
            senderName: 'Miriam Lohrey',
            isMe: false
        }
    ],
    3: [
        {
            id: 1,
            text: '@alle Bitte bis Freitag die Programmpunkte eintragen',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4),
            senderId: 3,
            senderName: 'Team young+free Crottendorf',
            isMe: false
        },
        {
            id: 2,
            text: 'Erledigt! Ich habe meine Programmideen hochgeladen.',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3),
            senderId: 0,
            senderName: 'Ich',
            isMe: true
        },
        {
            id: 3,
            text: 'Neue Aufgabe: Programm für Samstag erstellen',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
            senderId: 3,
            senderName: 'Team young+free Crottendorf',
            isMe: false
        }
    ],
    4: [
        {
            id: 1,
            text: 'Die Materialliste ist jetzt online verfügbar',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6),
            senderId: 4,
            senderName: 'Lisa Frischmuth',
            isMe: false
        },
        {
            id: 2,
            text: 'Super, ich schaue sie mir gleich an!',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5.5),
            senderId: 0,
            senderName: 'Ich',
            isMe: true
        },
        {
            id: 3,
            text: 'Können wir die Materialbestellung besprechen?',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5),
            senderId: 4,
            senderName: 'Lisa Frischmuth',
            isMe: false
        }
    ],
    5: [
        {
            id: 1,
            text: 'Treffen wir uns morgen um 10 Uhr?',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 25),
            senderId: 0,
            senderName: 'Ich',
            isMe: true
        },
        {
            id: 2,
            text: 'Perfekt, ich bin dabei!',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24.5),
            senderId: 5,
            senderName: 'Jesko Bahlcke',
            isMe: false
        },
        {
            id: 3,
            text: 'Bis morgen beim Treffen!',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
            senderId: 5,
            senderName: 'Jesko Bahlcke',
            isMe: false
        }
    ]
})

const selectedChatId = ref<number>(1)
const newMessage = ref('')
const messagesContainer = ref<HTMLElement>()

const selectedChat = computed(() => chats.value.find(c => c.id === selectedChatId.value))
const currentMessages = computed(() => messages.value[selectedChatId.value] || [])

function selectChat(chatId: number) {
    selectedChatId.value = chatId
    // Mark messages as read
    const chat = chats.value.find(c => c.id === chatId)
    if (chat) {
        chat.unreadCount = 0
    }
    // Scroll to bottom
    nextTick(() => {
        scrollToBottom()
    })
}

function sendMessage() {
    if (!newMessage.value.trim()) return

    const message: Message = {
        id: currentMessages.value.length + 1,
        text: newMessage.value,
        timestamp: new Date(),
        senderId: 0,
        senderName: 'Ich',
        isMe: true
    }

    if (!messages.value[selectedChatId.value]) {
        messages.value[selectedChatId.value] = []
    }

    (messages.value[selectedChatId.value] as Message[]).push(message)

    // Update last message in chat list
    const chat = chats.value.find(c => c.id === selectedChatId.value)
    if (chat) {
        chat.lastMessage = newMessage.value
        chat.timestamp = new Date()
    }

    newMessage.value = ''

    nextTick(() => {
        scrollToBottom()
    })
}

function scrollToBottom() {
    if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
}

function formatTime(date: Date) {
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 24) {
        return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    } else if (diffInHours < 48) {
        return 'Gestern'
    } else {
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    }
}

onMounted(() => {
    scrollToBottom()
})
</script>

<template>
    <UDashboardPanel>

        <template #header>
            <DashboardPageHeader title="Chats" icon="i-lucide-message-circle"
                description="Eine Übersicht Ihrer aktuellen Chats" />
        </template>

        <template #body>
            <DashboardPageBody class="grow">
                <div class="flex h-full gap-4">
                    <!-- Chat List -->
                    <div class="w-80 shrink-0">
                        <UCard class="h-full">
                            <div class="space-y-1">
                                <div v-for="chat in chats" :key="chat.id"
                                    class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                                    :class="{ 'bg-gray-100 dark:bg-gray-800': selectedChatId === chat.id }"
                                    @click="selectChat(chat.id)">
                                    <div class="relative">
                                        <UAvatar :src="chat.avatar" :alt="chat.name" size="md" />
                                        <span v-if="chat.online"
                                            class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-900 rounded-full"></span>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center justify-between">
                                            <p class="font-semibold text-sm truncate">{{ chat.name }}</p>
                                            <span class="text-xs text-gray-500">{{ formatTime(chat.timestamp) }}</span>
                                        </div>
                                        <div class="flex items-center justify-between">
                                            <p class="text-sm text-gray-500 truncate">{{ chat.lastMessage }}</p>
                                            <UBadge v-if="chat.unreadCount > 0" color="primary" size="xs" class="ml-2">
                                                {{ chat.unreadCount }}
                                            </UBadge>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <!-- Chat Messages -->
                    <div class="flex-1">
                        <UCard class="h-full flex flex-col">
                            <!-- Chat Header -->
                            <div v-if="selectedChat"
                                class="flex items-center gap-3 pb-4 border-b border-gray-200 dark:border-gray-700">
                                <div class="relative">
                                    <UAvatar :src="selectedChat.avatar" :alt="selectedChat.name" size="md" />
                                    <span v-if="selectedChat.online"
                                        class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-900 rounded-full"></span>
                                </div>
                                <div>
                                    <p class="font-semibold">{{ selectedChat.name }}</p>
                                    <p class="text-sm text-gray-500">{{ selectedChat.online ? 'Online' : 'Offline' }}
                                    </p>
                                </div>
                            </div>

                            <!-- Messages -->
                            <div ref="messagesContainer" class="flex-1 overflow-y-auto py-4 space-y-4">
                                <div v-for="message in currentMessages" :key="message.id" class="flex"
                                    :class="message.isMe ? 'justify-end' : 'justify-start'">
                                    <div class="max-w-[70%] rounded-lg px-4 py-2" :class="message.isMe
                                        ? 'bg-primary-500 text-white'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'">
                                        <p class="text-sm">{{ message.text }}</p>
                                        <p class="text-xs mt-1"
                                            :class="message.isMe ? 'text-primary-100' : 'text-gray-500'">
                                            {{ formatTime(message.timestamp) }}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <!-- Message Input -->
                            <div class="pt-4 border-t border-gray-200 dark:border-gray-700">
                                <form @submit.prevent="sendMessage" class="flex gap-2">
                                    <UInput v-model="newMessage" placeholder="Nachricht eingeben..." size="lg"
                                        class="flex-1" :ui="{ base: 'w-full' }" />
                                    <UButton type="submit" icon="i-lucide-send" size="lg"
                                        :disabled="!newMessage.trim()">
                                        Senden
                                    </UButton>
                                </form>
                            </div>
                        </UCard>
                    </div>
                </div>
            </DashboardPageBody>
        </template>

    </UDashboardPanel>
</template>